import {parse} from '@babel/parser';
import {type Finding} from '../lib/finding.js';
import {lineText, type SourceFile} from './source.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

const EXPENSIVE_CALL =
  /^(ProductMgr\.getProduct|ProductMgr\.queryAllSiteProducts|CatalogMgr\.getCategory|CustomObjectMgr\.(getCustomObject|queryCustomObjects|getAllCustomObjects)|OrderMgr\.(getOrder|searchOrders|queryOrders)|CustomerMgr\.(getCustomerByLogin|getCustomerByCustomerNumber|searchProfiles|queryProfiles)|SystemObjectMgr\.querySystemObjects)$/;
const EXPENSIVE_METHOD = /^(getVariants|getVariationModel|getPriceModel|getAvailabilityModel|getOnlineCategories|getProductSetProducts)$/;
const SEEKABLE =
  /^(ProductMgr\.queryAllSiteProducts|ProductMgr\.queryProductsInCatalog|CustomObjectMgr\.(queryCustomObjects|getAllCustomObjects)|SystemObjectMgr\.querySystemObjects|OrderMgr\.(searchOrders|queryOrders)|CustomerMgr\.(searchProfiles|queryProfiles))$/;
const ITERATOR_CALLBACK = /^(forEach|map|filter|some|every|reduce|find)$/;
const SECRET_NAME = /(password|passwd|secret|api_?key|apikey|client_?secret|access_?token|private_?key)/i;

export function analyzeJs(file: SourceFile): Finding[] {
  let ast: Node;
  try {
    ast = parse(file.content, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      plugins: [],
    });
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  const isController = /\/controllers\//.test(file.path);
  const at = (node: Node) => `${file.path}:${node.loc?.start.line ?? 0}`;
  const excerpt = (node: Node) => lineText(file.content, node.loc?.start.line ?? 0);

  walk(ast.program, [], (node, ancestors) => {
    // JS-001 expensive API call inside a loop or iteration callback
    if (node.type === 'CallExpression') {
      const name = calleeName(node.callee);
      const method = node.callee?.type === 'MemberExpression' ? propName(node.callee) : undefined;
      const expensive = (name && EXPENSIVE_CALL.test(name)) || (method && EXPENSIVE_METHOD.test(method));
      if (expensive && insideLoop(ancestors)) {
        findings.push({
          rule: 'JS-001',
          category: 'code',
          severity: 'high',
          title: `Expensive call inside a loop: ${name ?? method}`,
          evidence: [{location: at(node), excerpt: excerpt(node)}],
          impact: 'Multiplies database access and response time by the number of items; a typical cause of quota violations and slow pages.',
          fix: 'Move the call out of the loop, load the data once (search model, map by id) or use a cache.',
        });
      }

      // JS-003 Transaction.wrap with a loop inside
      if (name === 'Transaction.wrap' && node.arguments?.[0] && containsLoop(node.arguments[0])) {
        findings.push({
          rule: 'JS-003',
          category: 'code',
          severity: 'medium',
          title: 'Transaction containing a loop',
          evidence: [{location: at(node), excerpt: excerpt(node)}],
          impact: 'Long transactions hold locks and can exceed the quota of objects changed per transaction.',
          fix: 'Split into smaller transactions (batches) or move the loop out of the transaction.',
        });
      }

      // JS-006 legacy importPackage / importScript
      if (name === 'importPackage' || name === 'importScript') {
        findings.push({
          rule: 'JS-006',
          category: 'code',
          severity: 'low',
          title: `Legacy API: ${name}`,
          evidence: [{location: at(node), excerpt: excerpt(node)}],
          impact: 'Legacy code, harder to maintain and optimize.',
          fix: 'Replace with require() of dw.* modules or cartridge modules.',
        });
      }

      // JS-007 order searches from storefront controllers
      if (isController && name && /^OrderMgr\.(searchOrders|queryOrders)$/.test(name)) {
        findings.push({
          rule: 'JS-007',
          category: 'code',
          severity: 'high',
          title: `Order search from a storefront controller: ${name}`,
          evidence: [{location: at(node), excerpt: excerpt(node)}],
          impact: 'Order queries in the shopper request path: slow and subject to quota.',
          fix: 'Use customer.getOrderHistory() for the customer history or move the logic to a job.',
        });
      }
    }

    // JS-004 direct HTTPClient instead of the service framework
    if (node.type === 'NewExpression') {
      const name = calleeName(node.callee);
      if (name && /(^|\.)HTTPClient$/.test(name)) {
        findings.push({
          rule: 'JS-004',
          category: 'code',
          severity: 'medium',
          title: 'Direct HTTP call with HTTPClient',
          evidence: [{location: at(node), excerpt: excerpt(node)}],
          impact: 'Outside the service framework: no central timeout, circuit breaker, mocking or service monitoring.',
          fix: 'Use LocalServiceRegistry.createService with a service configured in Business Manager.',
        });
      }
    }

    // JS-005 hardcoded secrets
    const secret = hardcodedSecret(node);
    if (secret) {
      findings.push({
        rule: 'JS-005',
        category: 'code',
        severity: 'high',
        title: `Possible credential in code: ${secret}`,
        evidence: [{location: at(node), excerpt: '<value hidden>'}],
        impact: 'Credentials in deployed code are visible to anyone with access to the cartridges and repositories.',
        fix: 'Move the value to a service credential or a protected (password) site preference.',
      });
    }

    // JS-009 empty catch block
    if (node.type === 'CatchClause' && node.body?.body?.length === 0) {
      findings.push({
        rule: 'JS-009',
        category: 'code',
        severity: 'low',
        title: 'Empty catch block',
        evidence: [{location: at(node), excerpt: excerpt(node)}],
        impact: "Errors are swallowed without logging: problems become invisible.",
        fix: 'At least log with Logger.error and handle the error case.',
      });
    }
  });

  // JS-002 SeekableIterator never closed (per function)
  walk(ast.program, [], (node) => {
    if (!isFunction(node) && node.type !== 'Program') return;
    const body = node.type === 'Program' ? node : node.body;
    const assigned: Array<{name: string; node: Node; api: string}> = [];
    walk(body, [], (inner, anc) => {
      if (anc.some(isFunction)) return; // nested functions handled separately
      if (inner.type === 'VariableDeclarator' && inner.init?.type === 'CallExpression') {
        const api = calleeName(inner.init.callee);
        if (api && SEEKABLE.test(api) && inner.id?.type === 'Identifier') assigned.push({name: inner.id.name, node: inner, api});
      }
    });
    if (assigned.length === 0) return;
    const src = file.content.slice(body.start ?? 0, body.end ?? file.content.length);
    for (const a of assigned) {
      const closed = new RegExp(`\\b${a.name}\\s*\\.\\s*close\\s*\\(`).test(src);
      const returned = new RegExp(`return\\s+${a.name}\\b`).test(src);
      if (!closed && !returned) {
        findings.push({
          rule: 'JS-002',
          category: 'code',
          severity: 'high',
          title: `SeekableIterator never closed: ${a.name} (${a.api})`,
          evidence: [{location: at(a.node), excerpt: excerpt(a.node)}],
          impact: 'Unclosed iterators keep resources open and trigger quota warnings.',
          fix: `Call ${a.name}.close() in a finally block after iterating.`,
        });
      }
    }
  });

  return findings;
}

function walk(node: Node, ancestors: Node[], visit: (node: Node, ancestors: Node[]) => void): void {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) walk(child, next, visit);
    else if (value && typeof value.type === 'string') walk(value, next, visit);
  }
}

function isFunction(node: Node): boolean {
  return node?.type === 'FunctionDeclaration' || node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression';
}

const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);

function insideLoop(ancestors: Node[]): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (LOOP_TYPES.has(a.type)) return true;
    if (isFunction(a)) {
      // a function is "in a loop" only if it is an iteration callback
      const parent = ancestors[i - 1];
      if (parent?.type === 'CallExpression' && parent.arguments?.includes(a)) {
        const method = parent.callee?.type === 'MemberExpression' ? propName(parent.callee) : undefined;
        const name = calleeName(parent.callee);
        if ((method && ITERATOR_CALLBACK.test(method)) || name === 'collections.forEach' || name === 'collections.map') return true;
      }
      return false;
    }
  }
  return false;
}

function containsLoop(node: Node): boolean {
  let found = false;
  walk(node, [], (n, anc) => {
    if (found) return;
    if (LOOP_TYPES.has(n.type)) found = true;
    if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && ITERATOR_CALLBACK.test(propName(n.callee) ?? '') && anc.length > 0) found = true;
  });
  return found;
}

function propName(member: Node): string | undefined {
  if (member.computed) return member.property?.type === 'StringLiteral' ? member.property.value : undefined;
  return member.property?.name;
}

/** "ProductMgr.getProduct" for ProductMgr.getProduct(...), also handles require('dw/catalog/ProductMgr').getProduct */
function calleeName(callee: Node): string | undefined {
  if (!callee) return undefined;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression') {
    const prop = propName(callee);
    if (!prop) return undefined;
    const obj = callee.object;
    if (obj.type === 'Identifier') return `${obj.name}.${prop}`;
    if (obj.type === 'MemberExpression') {
      const left = calleeName(obj);
      if (!left) return prop;
      // dw.catalog.ProductMgr.getProduct -> ProductMgr.getProduct
      const last = left.split('.').pop();
      return `${last}.${prop}`;
    }
    if (obj.type === 'CallExpression' && obj.callee?.type === 'Identifier' && obj.callee.name === 'require') {
      const mod = obj.arguments?.[0]?.value as string | undefined;
      if (mod) return `${mod.split('/').pop()}.${prop}`;
    }
    return prop;
  }
  return undefined;
}

function hardcodedSecret(node: Node): string | undefined {
  let name: string | undefined;
  let value: Node;
  if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier') {
    name = node.id.name;
    value = node.init;
  } else if (node.type === 'ObjectProperty') {
    name = node.key?.name ?? node.key?.value;
    value = node.value;
  } else if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression') {
    name = propName(node.left);
    value = node.right;
  }
  if (!name || !SECRET_NAME.test(name)) return undefined;
  if (value?.type !== 'StringLiteral') return undefined;
  const v: string = value.value;
  if (v.length < 6 || /^(\*+|x+|changeme|todo|tbd|<.*>|\$\{.*\})$/i.test(v)) return undefined;
  // looks like a preference id or a key name, not a secret
  if (/^[a-z][a-zA-Z]+$/.test(v) && v.length < 30) return undefined;
  return name;
}
