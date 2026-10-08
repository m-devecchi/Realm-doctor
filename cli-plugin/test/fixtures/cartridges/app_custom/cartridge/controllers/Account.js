'use strict';

var server = require('server');
var OrderMgr = require('dw/order/OrderMgr');
var HTTPClient = require('dw/net/HTTPClient');

server.get('Orders', function (req, res, next) {
    var orders = OrderMgr.searchOrders('customerNo={0}', 'creationDate desc', req.currentCustomer.profile.customerNo); // JS-007 (+ JS-002)
    var client = new HTTPClient(); // JS-004
    client.open('GET', 'https://production-eu01-acme.demandware.net/on/demandware.store/Sites-RefArch-Site/default/Loyalty-Points'); // HF-002
    client.send();
    res.render('account/orders', {orders: orders});
    next();
});

module.exports = server.exports();
