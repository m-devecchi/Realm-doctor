'use strict';

var ProductMgr = require('dw/catalog/ProductMgr');
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Transaction = require('dw/system/Transaction');
var collections = require('*/cartridge/scripts/util/collections');

var API_KEY = 'sk_live_9f8a7b6c5d4e3f2a1b0c';

function getTiles(productIds) {
    var tiles = [];
    for (var i = 0; i < productIds.length; i++) {
        var product = ProductMgr.getProduct(productIds[i]); // JS-001
        tiles.push(product);
    }
    return tiles;
}

function getVariantCounts(products) {
    return products.map(function (p) {
        return p.getVariants().length; // JS-001 (iteration callback)
    });
}

function exportStores() {
    var it = CustomObjectMgr.queryCustomObjects('Store', '', null); // JS-002 never closed
    var out = [];
    while (it.hasNext()) {
        out.push(it.next().custom.name);
    }
    return out;
}

function updateAll(items) {
    Transaction.wrap(function () { // JS-003
        items.forEach(function (item) {
            item.custom.flag = true;
        });
    });
}

function safeParse(value) {
    try {
        return JSON.parse(value);
    } catch (e) {} // JS-009
    return null;
}

importPackage(dw.system); // JS-006

module.exports = {
    getTiles: getTiles,
    getVariantCounts: getVariantCounts,
    exportStores: exportStores,
    updateAll: updateAll,
    safeParse: safeParse,
    apiKey: API_KEY
};
