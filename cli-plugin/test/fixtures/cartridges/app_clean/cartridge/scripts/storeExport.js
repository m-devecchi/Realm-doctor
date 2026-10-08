'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var Logger = require('dw/system/Logger');
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');

function exportStores() {
    var it = CustomObjectMgr.queryCustomObjects('Store', '', null);
    var out = [];
    try {
        while (it.hasNext()) {
            out.push(it.next().custom.name);
        }
    } finally {
        it.close();
    }
    return out;
}

function getProduct(id) {
    return ProductMgr.getProduct(id);
}

function parse(value) {
    try {
        return JSON.parse(value);
    } catch (e) {
        Logger.error('Invalid JSON: {0}', e.message);
        return null;
    }
}

var service = LocalServiceRegistry.createService('erp.http', {
    createRequest: function (svc, args) {
        return JSON.stringify(args);
    }
});

module.exports = {exportStores: exportStores, getProduct: getProduct, parse: parse, service: service};
