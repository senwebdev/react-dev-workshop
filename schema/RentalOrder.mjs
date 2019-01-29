import _ from 'lodash'
import moment from 'moment'
import { isAcctOwnerManager, isAcctOwnerManagerViewer }  from '../auth/auth.mjs'
import { addDocEvent } from './DocEvent.mjs'

import {checkAcctforValidPayment} from './Account.mjs'

import {addInvoice} from './Invoice.mjs'
import {addContainersFromDocLine} from './Container.mjs'

//Custom schema

/*
Flow must be create SO > create Invoice > create/re-use containers > complete
Status:
INIT - just created SO
BILLED - Created Invoice
PROCESSING - Credit deducted, pending to send empty boxes
COMPLETED - All credit deducted and all boxes sent
*/

export const ROAddUpdateInvoice = async (obj, args, ctx, info) => {
    //args must have either invoice or invoice_id
    //args={invoice: Invoice, invoice_id: String}
    
    console.log('RentalOrder.ROAddUpdateInvoice')
    
    //1. check for access requirement
    //2. field checking
    ctx.spFunction['p001'].convertArgs(args)
    
    
    
    let invoice
    if (args.invoice) { invoice = args.invoice }
    else if (args.invoice_id) { invoice = await ctx.db['p001'].collection('Invoice').find({_id: args.invoice_id}, {_id: 1, totalAmt: 1, settledAmt: 1, status: 1, rentalOrder_id: 1 } ).limit(1).toArray() }
    else {
        throw new ctx.err({message: "INVALID", data: {invoice: undefined}})
    }
    
    console.log('RentalOrder.ROAddUpdateInvoice.1')
    
    //3. add/mod fields
    let RO_id = invoice.rentalOrder_id
    
    //get rentalOrder object from db
    let RO = await ctx.db['p001'].collection('RentalOrder').find({_id: RO_id}, {_id: 1, invoiceList: 1, totalAmt: 1, billedAmt: 1, paidAmt: 1, status: 1 } ).limit(1).toArray()
    RO = RO[0]
    
    console.log('RentalOrder.ROAddUpdateInvoice.2')
    
    let invoice_args = _.pick(invoice, ['_id', 'totalAmt', 'settledAmt','status'])
    let ROBilledAmt=0, ROPaidAmt=0
    let status='PROCESSING_UNPAID'
    //check if there already existing invoice registered in RO (i.e. is update, not add)
    let existingInvoiceEntry = RO.invoiceList.find(obj=> (obj._id==invoice._id) )
    
    let newRO
    //if have existing invoice, we need to calc and update RO
    if (existingInvoiceEntry != undefined) {
        console.log('RentalOrder.ROAddUpdateInvoice.3.existingInvoiceEntry != undefined')
        
        ROBilledAmt = RO.billedAmt + invoice.totalAmt - existingInvoiceEntry.totalAmt
        ROPaidAmt = RO.paidAmt + invoice.settledAmt - existingInvoiceEntry.settledAmt
        
        if (ROPaidAmt==RO.totalAmt) { status='PROCESSING_PAID' }
        
        newRO = await ctx.db['p001'].collection('RentalOrder').findOneAndUpdate(
            {_id: RO_id, 'invoiceList._id': invoice._id},
            {$set: { billedAmt: ROBilledAmt,
                    paidAmt: ROPaidAmt,
                    status: status,
                    updateBy_id: ctx.req.user._id,
                    updateDateTime: moment.toDate(),
                    'invoiceList.totalAmt': invoice_args.totalAmt,
                    'invoiceList.settledAmt': invoice_args.settledAmt,
                    'invoiceList.status': invoice_args.status
            }})
    }
    else {
        console.log('RentalOrder.ROAddUpdateInvoice.3.existingInvoiceEntry not found')
        
        ROBilledAmt = RO.billedAmt + invoice.totalAmt
        ROPaidAmt = RO.paidAmt + invoice.settledAmt
        
        if (ROPaidAmt==RO.totalAmt) { status='PROCESSING_PAID' }
        
        newRO = await ctx.db['p001'].collection('RentalOrder').updateOne(
            {_id: RO_id},
            {
                $set: { billedAmt: ROBilledAmt,
                    paidAmt: ROPaidAmt,
                    status: status,
                    updateBy_id: ctx.req.user._id,
                    updateDateTime: moment().toDate()
                },
                $push: { invoiceList: invoice_args }
            })
    }
    if (newRO.error) {
        throw new Error('write to DB error ROAddUpdateInvoice, args=', args)
    }
    else {
        let msg = (existingInvoiceEntry==undefined) ? ('Invoice inserted, new invoice = '+invoice._id) : ('Invoice updated, updated invoice = '+invoice_args+', original invoice='+ existingInvoiceEntry)
        let doc_event = await addDocEvent(obj, {docType: 'RentalOrder', docEventType: 'UPDATE', doc_id: RO_id, msg: msg}, ctx, info)
    }
    
    console.log('RentalOrder.ROAddUpdateInvoice.4.completed')
    
    return newRO
    
    //4. query & return
}

export const typeDef = `
    
    enum rentalOrderStatus {
        INIT
        PROCESSING_PAID
        PROCESSING_UNPAID
        COMPLETED_PAID
        COMPLETED_UNPAID
        HOLD
        CANCELLED
    }
    
    extend type Query {
        getRentalOrder(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [RentalOrder]
        
        getRecentROListByUser: [RentalOrder]!
        
        getROById(RO_id: String!): RentalOrder!
    }
    
    extend type Mutation {
        addRentalOrderFromQuotation(quotation_id: String!, billingAddress_id: String!, account_id: String, cardId: String!): RentalOrder
    }
    
    type RentalOrder {
        _id: ID!,
        version: String!,
        status: rentalOrderStatus!,
        printCount: Int,
        docEvent_id: [DocEvent],
        account_id: Account,
        createDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime,
        createBy_id: User,
        updateBy_id: User,
        invoiceList: [InvoiceList]!,
        
        quotation_id: Quotation,
        
        billingAddress_id: Address!,
        billingAddress: addressSnapShot!,
        
        docLines: [RentalOrderDetails]!,
        
        accountType: String!,
        
        totalAmt: Float!,
        billedAmt: Float!,
        paidAmt: Float!,
        
        remarks: String
    }
    
    type RentalOrderDetails{
        SKU_id: SKUMaster!,
        SKUName: String!,
        containerList: [Container_subset],
        
        rentMode: rentMode!,
        "this is not used to calc line total price.  only to replicate to container and calc expiry date"
        duration: Int!,
        qty: Int!,
        
        rent_unitPrice: Float!,
        
        "qty x duration x unitPrice"
        rent_lineTotal: Float!,
        
        remarks: String
    }
    `
    

export const resolver = {
    Query: {
        getRentalOrder: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('RentalOrder'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        },
        getRecentROListByUser: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                console.log('getRecentROListByUser')
                console.time('getRecentROListByUser')
                
                const acct_list = _.union(ctx.req.user.accountOwn_id, ctx.req.user.accountManage_id, ctx.req.user.accountView_id)
                
                console.log('getRecentROListByUser.acctList', acct_list)
                
                let ROlist = await ctx.db['p001'].collection('RentalOrder').find({account_id: {$in: acct_list}, updateDateTime: {$gt: moment().subtract(1, 'years').toDate()}}).toArray()
                console.timeEnd('getRecentROListByUser')
                return ROlist
                //4. query & return
            } catch(e) { throw e }
        },
        getROById: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                console.log('getROById')
                ctx.spFunction['p001'].convertArgs(args)
                const acct_list = _.union(ctx.req.user.accountOwn_id, ctx.req.user.accountManage_id, ctx.req.user.accountView_id)
                
                console.log('getROById.acctList', acct_list)
                
                let RO = await ctx.db['p001'].collection('RentalOrder').find({_id: args.RO_id}).limit(1).toArray()
                
                //if RO query returns nothing, throw error since id is wrong.
                if (RO.length>0) { RO = RO[0] }
                else { throw new ctx.err({message: "NOT_FOUND", data: {RO_id: args.RO_id}}) }
                
                //make sure suer have access right to the doc
                isAcctOwnerManagerViewer(ctx, RO.account_id)
                console.log('RO=', RO)
                
                //4. query & return
                return RO
            } catch(e) { throw e }
        },
    },
    Mutation: {
        addRentalOrderFromQuotation: async (obj, args, ctx, info) => {
            try {
                /*
                1. Check validity of quotation
                2. check validity of quotation's account, and current user is owner/manager of account
                3. re-calc the quotation
                4a. create SO and status='INIT'
                4b. update quotation status
                4c. create invoice
                
                */
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                console.log('addRentalOrderFromQuotation.1')
                let quotation = await ctx.db['p001'].collection('Quotation').find({_id: args.quotation_id}).limit(1).toArray()
                
                if (quotation.length===0) {
                    throw new ctx.err({message: "INVALID", data: {quotation_id: args.quotation_id}})
                }
                else { quotation = quotation[0] }
                
                if (quotation.status !== 'INIT') {
                    throw new ctx.err({message: "WRONG_STATUS", data: {quotation_id: args.quotation_id}})
                }
                
                
                //2. field checking
                console.log('addRentalOrderFromQuotation.2')
                let account = quotation.account_id || args.account_id
                //check acct_id embed in quotation
                if (quotation.account_id != undefined) {
                    isAcctOwnerManager(ctx, quotation.account_id) //First check if user own/manage acct
                    account = await ctx.db['p001'].collection('Account').find({_id: quotation.account_id, isActive: true}, {accountType: 1, stripeCustomerObject: 1} ).toArray() //Make sure account is valid and active
                    if (account.length<1) {
                        throw new ctx.err({message: "INVALID", data: {account_id: quotation.account_id}})
                    }
                    else { account = account[0] }
                }
                //check acct_id if supplied from query
                else if (args.account_id != undefined) {
                    isAcctOwnerManager(ctx, args.account_id) //First check if user own/manage acct
                    account = await ctx.db['p001'].collection('Account').find({_id: args.account_id, isActive: true}, {accountType: 1, stripeCustomerObject: 1} ).limit(1).toArray()//Make sure account is valid and active
                    if (account.length<1) {
                        throw new ctx.err({message: "NOT_FOUND", data: {account_id: args.account_id}})
                    }
                    else { account = account[0] }
                }
                //account_id is missing in both args and quotation object
                else {
                    throw new ctx.err({message: "INVALID", data: {account_id: args.account_id}})
                }
                
                //check if customer object is present.  If not return error and ask front end to get input from user
                const needGetPayment = await checkAcctforValidPayment(ctx, account)
                if (!needGetPayment) {
                    throw new ctx.err({message: "NO_PAYMENT_INFO", data: {account_id: account._id}})
                }
                
                //check equality if both sides supplied
                if ((args.account_id != undefined) & (quotation.account_id != undefined)) {
                    if (!(quotation.account_id.equals(args.account_id) )) {
                        throw new ctx.err({message: "INVALID", data: {account_id: args.account_id}})
                    }
                }
                //throw error if both sides not supplied
                if ((args.account_id == undefined) & (quotation.account_id == undefined)) {
                    throw new ctx.err({message: "INVALID", data: {account_id: null}})
                }
                
                //check addresses
                const addresses_id = [args.billingAddress_id]
                if (args.shippingAddress_id) { addresses_id.push(args.shippingAddress_id) }
                const addresses = await ctx.db['p001'].collection('Address').find({_id: {$in: addresses_id}, isActive: true} ).toArray()
                const billingAddress = addresses.find(v=>v._id.equals(args.billingAddress_id))
                if ( billingAddress==undefined ) {
                    throw new ctx.err({message: "INVALID", data: {billingAddress_id: args.billingAddress_id}})
                }
                
                //3. recalc quotation
                
                console.log('addRentalOrderFromQuotation.3')
                
                //potentially to re-check all priceList.  now just trust the priceList is still valid
                let orderLines = []
                let totalAmt = 0
                const SKU = await ctx.db['p001'].collection('SKUMaster').find({_id: {$in: quotation.quotationDetails.map(v=>v.SKU_id)}}, {_id: 1, shortCode: 1, name:1, isActive: 1}).toArray()
                for (let i=0;i<quotation.quotationDetails.length;i++) {
                    let lineTotal = quotation.quotationDetails[i].rent_unitPrice * quotation.quotationDetails[i].qty
                    
                    orderLines.push({
                        SKU_id: quotation.quotationDetails[i].SKU_id,
                        
                        //fixme we should try catch here, SKU may not 100% find matching object
                        SKUName: SKU.find(v=> v._id.equals(quotation.quotationDetails[i].SKU_id) ).name,
                        rentMode: quotation.quotationDetails[i].rentMode,
                        duration: quotation.quotationDetails[i].duration,
                        qty: quotation.quotationDetails[i].qty,
                        
                        rent_unitPrice: quotation.quotationDetails[i].rent_unitPrice,
                        rent_lineTotal: lineTotal,
                    })
                    totalAmt = totalAmt + lineTotal
                }
                
                //insert Rental Order
                let rentalOrder = {
                    version: "1.0",
                    printCount: 0,
                    docEvent_id: [],
                    status: "INIT",
                    invoiceList: [],
                    quotation_id: quotation._id,
                    billingAddress_id: args.billingAddress_id,
                    billingAddress: _.pick(billingAddress, ['legalName', 'addressCountry', 'addressRegion1','addressRegion2', 'streetAddress', 'telephone']),
                    docLines: orderLines,
                    account_id: account._id,
                    accountType: account.accountType,
                    totalAmt: totalAmt,
                    billedAmt: 0,
                    paidAmt: 0,
                    createDateTime: moment().toDate(),
                    updateDateTime: moment().toDate(),
                    createBy_id: ctx.req.user._id,
                    updateBy_id: ctx.req.user._id
                }
                
                let doc_ro = await ctx.db['p001'].collection('RentalOrder').insertOne(rentalOrder)
                doc_ro = doc_ro.ops[0]
                let doc_event = await addDocEvent(obj, {docType: 'RentalOrder', docEventType: 'CREATE', doc_id: doc_ro._id, msg: ''}, ctx, info)
                
                
                console.log('addRentalOrderFromQuotation.3.update quotation status')
                //update quotation status
                let doc_q = await ctx.db['p001'].collection('Quotation').updateOne({_id: quotation._id}, {$set: {status: 'CONVERTED_SO'}})
                
                //insert invoice
                
                //first get priceList, and check if we should charge immediately.  We will just get first entry, and assume the whole rentalOrder is following the same price list\
                //Fixme to allow RentalOrder cover multiple price list
                const pricelist = await ctx.db['p001'].collection('PriceList').find({_id: quotation.quotationDetails[0].priceList_id}, {_id: 1, chargeImmediately: 1}).limit(1).toArray()
                
                console.log('addRentalOrderFromQuotation.3.insert invoice')
                
                let doc_inv = await addInvoice(obj, {orderDoc: doc_ro, orderType: 'RentalOrder', chargeNow: pricelist[0].chargeImmediately}, ctx, info)
                
                console.log('addRentalOrderFromQuotation.3.return RO', doc_ro)
                
                //create Containers
                for (let i=0;i<doc_ro.docLines.length;i++) {
                    let container_subset = await addContainersFromDocLine(ctx, doc_ro.docLines[i], doc_ro.account_id, doc_ro._id)
                    
                    //update the doc_ro object, later on push the whole docLines back to server, then return doc_ro to front-end
                    doc_ro.docLines[i]['containerList'] = container_subset
                }
                let doc_ro2 = await ctx.db['p001'].collection('RentalOrder').findOneAndUpdate({_id: doc_ro._id}, {$set: {docLines: doc_ro.docLines}})
                console.log('doc_ro2=',doc_ro2)
                
                doc_event = await addDocEvent(obj, {docType: 'RentalOrder', docEventType: 'UPDATE', doc_id: doc_ro._id, msg: 'Containers created.'}, ctx, info)
                
                return doc_ro
                
                /* these will be used only when SO is created from scratch.  This method now create from quotation_id, so temp comment out.
                //check for qty<1 error + compile item List to get info from DB
                let SKUList = []
                for(let i=0 ; i< args.docLines.length ; i++){
                    let li = args.docLines[i]
                    
                    ctx.spFunction['p001'].convertArgs(li)
                    if (li.qty<1) { 
                        throw new ctx.err({message: "INVALID", data: {docLines: li }})
                    }
                    SKUList.push(li.SKU_id)
                }
                
                //quotation_id
                if (args.hasOwnProperty('quotation_id')) {
                    const quotationCheck = await ctx.db['p001'].collection('Quotation').find({_id: args.quotation_id, status: {$in: ['INIT', 'CONVERTED_SO']} }).limit(1).count(true)
                    
                    if (quotationCheck!=1) {
                        throw new ctx.err({message: "NO_RECORD", data: {quotation_id: args.quotation_id }})
                    }
                }
                //billing address id
                const billingAddressCheck = await ctx.db['p001'].collection('Address').find({_id: args.billingAddress_id, account_id: args.account_id }).limit(1).toArray()
                    
                if (billingAddressCheck.length<1) {
                    throw new ctx.err({message: "NO_RECORD", data: {billingAddress_id: args.billingAddress_id }})
                }
                
                args['billingAddress'] = {
                    legalName: billingAddressCheck[0].legalName,
                    addressCountry: billingAddressCheck[0].addressCountry,
                    addressRegion: billingAddressCheck[0].addressRegion,
                    streetAddress: billingAddressCheck[0].streetAddress,
                    telephone: billingAddressCheck[0].telephone
                }
                
                //3. add/mod fields
                args['version'] = "1"
                args['salesOrderType'] = 'RENTAL'
                args['createBy_id'] = ctx.req.user._id
                args['updateBy_id'] = ctx.req.user._id
                args['createDateTime'] = moment().toDate()
                args['updateDateTime'] = moment().toDate()
                args['status'] = 'INIT'
                args['accountType'] = checkAccount.accountType
                args['printCount'] = 0
                args['docEvent_id'] = []
                
                //calculate totalAmt + popular docLines
                args['totalAmt'] = 0
                args['billedAmt'] = 0
                args['paidAmt'] = 0
                
                //get info from DB
                const checkSKUList = await ctx.db['p001'].collection('SKUMaster').find({_id: {$in: SKUList}, isActive: true },{projection: {name:1}} ).limit(1).toArray()
                const checkPriceList = await ctx.db['p001'].collection('PriceList').find({
                    code: checkAccount.priceList,
                    rentMode: args.rentMode,
                    validFrom: { $lte: moment().toDate() },
                    validTo: { $gte: moment().toDate() },
                    item_id: {$in: SKUList}
                }).toArray()
                
                for(let i=0 ; i< args.docLines.length ; i++){
                    let li = args.docLines[i]
                    if (!_.has(li,'unitTotal')) {
                        let priceListDoc = checkPriceList.find((v)=> {
                            return (v.item_id.equals(li.SKU_id))
                        })
                        if (!priceListDoc) {
                            throw new ctx.err({message: "NO_RECORD", data: {docLines: [li] }})
                        }
                        li['unitTotal'] = priceListDoc.rent
                    }
                    li['lineTotal'] = li.unitTotal * li.qty
                    args.totalAmt = args.totalAmt + li.lineTotal
                }
                
                //4. query & return
                const a = await ctx.db['p001'].collection('SalesOrder').insertOne(args);
                return a.ops[0]*/
            } catch(e) { throw e }
        }
    },
    RentalOrder: {
        docLines: (obj) => { return obj.docLines },
    },
    RentalOrderDetails: {
        containerList: (obj) => { return obj.containerList }
    },
    Container: {
        rentalOrder_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('RentalOrder').findOne({_id: obj.rentalOrder_id})
                return doc
            } catch(e) { throw e }
        }
    }
}

const getUpdateField = (op, fields) => {
    switch(op) {
        case 'SET': return {$set: fields}
        case 'INC': return {$inc: fields}
        case 'UNSET': return {$unset: fields}
        default: throw new Error('updateOp does not support this Operator: ' + op)
    }
}