import _ from 'lodash'
import moment from 'moment'
import { isStaff, isAcctOwnerManager }  from '../auth/auth.mjs'

import payTermAdjust from '../util/payTermAdjust.mjs'
import { addDocEvent } from './DocEvent.mjs'
import { ROAddUpdateInvoice } from './RentalOrder.mjs'
import { chargeType, addCharge } from './Charge.mjs'

export const invoiceStatus = ['PENDING', 'BILLED', 'PARTIAL_SETTLED', 'FULL_SETTLED', 'CHARGE_FAILED', 'HOLD', 'CANCELLED']

//PENDING = Just created
//BILLED = only available when payterm > 0.  In case payterm > 0, invoice presented but not yet due = billed
//PARTIAL_SETTLED = only for some strange reason the invoice is not fully paid
//FULLY_SETTLED = invoice is fully paid and done


export const addInvoice = async (obj, args, ctx, info) => {
    //args= {order_id: String, orderDoc: RentalOrder, orderType: orderType, invoiceDate: GraphQLDate!, chargeAmt: Float, chargeType: ChargeType, chargeNow: Boolean, invoiceAmt: Float}
    //if calling from internal, can provide orderDoc instead of order_id
    //if charge amt is omitted, default will charge total order amt
    //chargeNow default is yes
    //if invoiceAmt is omitted, default is to charge all remaining amt
    
    
    //Defaults: chargeType=STRIPE_APE, chargeNow=true
    try {
        //1. check for access requirement
        //SOURCE NEED TO MAKE SURE USER HAVE ACCESS TO ACCOUNT_ID.  NO CHECK WILL BE DONE HERE IF ORDERDOC IS PROVIDED
        
        //2. field checking
        ctx.spFunction['p001'].convertArgs(args)
        
        //make sure chargeType is correct if provided
        let chargeType
        if (args.chargeType) {
            if (!chargeType.includes(args.chargeType)) {
                throw new ctx.err({message: "INVALID", data: {chargeType: args.chargeType}})
            }
            chargeType = args.chargeType
        }
        else{ chargeType = 'STRIPE_API' }
        
        let updateOrder
        
        //make sure the XOrder exists.  if orderDoc is in args, use it, else retrieve orderDoc from DB using order_id and orderType
        let orderDoc
        if (!args.orderDoc) {
            let orderDoc = await ctx.db['p001'].collection(args.orderType).find({_id: args.order_id}).limit(1).toArray()
            if (orderDoc.length<1) {
                throw new ctx.err({message: "INVALID", data: {order_id: args.order_id}})
            }
            orderDoc = orderDoc[0]
            isAcctOwnerManager(ctx, orderDoc.account_id)
        }
        else { orderDoc = args.orderDoc }
        
        //check status of order, throw error if status is not processable
        if (['COMPLETED', 'HOLD', 'CANCELLED'].includes(orderDoc.status)) {
            throw new ctx.err({message: "INVALID", data: {order_id: args.order_id}})
        }
        
        let totalAmt
        const logicalInvoiceAmt = orderDoc.totalAmt - orderDoc.billedAmt
        //check and make sure invoiceAmt, chargeAmt don't have logical error
        //if invoiceAmt is omitted, default to charge the order's all remaining amt
        if (args.invoiceAmt) {
            if (args.invoiceAmt > logicalInvoiceAmt) { throw new ctx.err({message: "INVALID", data: {invoiceAmt: args.invoiceAmt}}) }
            totalAmt = args.invoiceAmt
        }
        else { totalAmt = logicalInvoiceAmt }
        
        let chargeAmt
        if (args.chargeAmt) {
            if (args.chargeAmt > totalAmt) { throw new ctx.err({message: "INVALID", data: {chargeAmt: args.chargeAmt}}) }
            chargeAmt = args.chargeAmt
        }
        else { chargeAmt = totalAmt }


        let account = await ctx.db['p001'].collection('Account').find({_id: orderDoc.account_id}).limit(1).toArray()
        account=account[0]
        let now = moment().toDate()
        
        //3. add/mod fields
        let invoice = {
            version: '1.0',
            orderType: args.orderType,
            status: 'PENDING',
            orderDesc: '',
            account_id: orderDoc.account_id,
            printCount: 0,
            docEvent_id: [],
            invoiceDate: args.invoiceDate || moment(now).startOf('day').toDate(),
            dueDate: payTermAdjust(account.paymentTerm).toDate(),
            billingAddress_id: orderDoc.billingAddress_id,
            billingAddress: orderDoc.billingAddress,
            totalAmt: totalAmt,
            settledAmt: 0,
            remarks: '',
            createDateTime: now,
            updateDateTime: now,
            createBy_id: ctx.req.user._id,
            updateBy_id: ctx.req.user._id,
            chargeList: [],
            chargeType: args.chargeType
        }

        
        switch(args.orderType) {
            case 'RentalOrder':
                invoice['rentalOrder_id'] = orderDoc._id
                updateOrder = ROAddUpdateInvoice
                break
            case 'PickupOrder':
                invoice['pickUpOrder_id'] = orderDoc._id
                break
            case 'DeliveryOrder':
                invoice['deliveryOrder_id'] = orderDoc._id
                break
            case 'Others':
                invoice['order_id'] = orderDoc._id
                break
            default:
                throw new ctx.err({message: "INVALID", data: {orderType: args.orderType}})
        }
        
        
        //4. query & return
        
        //insert invoice
        let doc_inv = await ctx.db['p001'].collection('Invoice').insertOne(invoice)
        doc_inv = doc_inv.ops[0]
        
        //insert DocEvent
        let inv_doc_event = addDocEvent(obj, {docType: 'Invoice', docEventType: 'CREATE', doc_id: doc_inv._id, msg: ''}, ctx, info)
        
        //trigger create charge depending on args
        const isChargeNow = args.chargeNow || true
        if (isChargeNow) {
            let {chargeDoc, chargeErr} = await addCharge(obj, {invoice: doc_inv, chargeAmt: chargeAmt, chargeType: chargeType, account: account}, ctx, info)
            
            if (chargeDoc.status=='SETTLED') {
                //update invoice after created charge.  settledAmt = chargeAmt because we are still creating the invoice, previous amt must be 0
                let inv_newStatus = (chargeAmt == totalAmt) ? 'FULL_SETTLED': 'PARTIAL_SETTLED'
                doc_inv = await ctx.db['p001'].collection('Invoice').findOneAndUpdate(
                    {_id: doc_inv._id},
                    {
                        $set: {settledAmt: chargeAmt, status: inv_newStatus},
                        $push: {chargeList: _.pick(chargeDoc, ['_id', 'status', 'type', 'totalAmt']) }
                    },
                    {returnOriginal : false})
                console.log('Invoice after update success')
                doc_inv = doc_inv.value
                
                inv_doc_event = addDocEvent(obj, {docType: 'Invoice', docEventType: 'UPDATE', doc_id: doc_inv._id, msg: 'Charge is added, id=' + chargeDoc._id}, ctx, info)
            }
            else {
                console.log('addInvoice.chargeDoc', chargeDoc)
                throw new ctx.err({message: "SPECIAL", data: {msg: 'We cannot charge your card successfully for now.  Our staff will handle the case manually and come back to you the soonest.  Please refer to this number in case of enquiry: '+doc_inv._id}})
            }
        }
        else {
            //if chargeNow=false, the charge will be created in pending state.  Invoice update to be BILLED
        }
        console.log('Invoice just before updateOrder')

        //Update the original order with added invoice
        let order_update = updateOrder(obj, {invoice: doc_inv}, ctx, info)
        
        return doc_inv

    } catch(e) { throw e }
}



//Custom schema
export const typeDef = `
    
    enum InvoiceStatus {
        PENDING
        BILLED
        PARTIAL_SETTLED
        FULL_SETTLED
        HOLD
        CANCELLED
        CHARGE_FAILED
    }
    
    enum orderType { 
        RentalOrder
        PickupOrder
        DeliveryOrder
        Others
    }
    
    extend type Query {
        getInvoice(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [Invoice]
    }
    
    extend type Mutation {
        addInvoice(order_id: String!, orderType: orderType, billingAddress_id: String!, invoiceAmt: Float, chargeAmt: Float, chargeNow: Boolean, chargeType: ChargeType): Invoice
    }
    
    type Invoice {
        _id: ID!,
        version: String!,
        status: InvoiceStatus!,
        printCount: Int,
        docEvent_id: [DocEvent],
        account_id: Account,
        createDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime,
        createBy_id: User,
        updateBy_id: User,
        
        orderType: orderType,
        
        "This describes why the invoice is created.  Only used when orderType=Others"
        orderDesc: String,
        
        rentalOrder_id: RentalOrder,
        pickUpOrder_id: String,
        deliveryOrder_id: String,
        order_id: String,
        
        invoiceDate: GraphQLDate,
        dueDate: GraphQLDate,
        
        chargeList: [ChargeList],
        
        billingAddress_id: Address,
        billingAddress: addressSnapShot,
        
        totalAmt: Float,
        settledAmt: Float,
        
        remarks: String
    }
    
    type InvoiceList {
        _id: ID!,
        totalAmt: Float!,
        settledAmt: Float!,
        status: InvoiceStatus!
    }`


export const resolver = {
    Query: {
        getInvoice: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('Invoice'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        }
    },
    Mutation: {
        addInvoice: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                
                //make sure SO exists
                let checkSO = await ctx.db['p001'].collection('SalesOrder').find({_id: args.salesOrder_id}).limit(1).toArray()
                if (!checkSO) {
                    throw new ctx.err({message: "INVALID", data: {salesOrder_id: args.salesOrder_id}})
                }
                checkSO = checkSO[0]
                
                //make sure user have access to SO account
                isAcctOwnerManager(ctx, checkSO.account_id)
                //2. field checking
                
                //billing address id
                const billingAddressCheck = await ctx.db['p001'].collection('Address').find({_id: args.billingAddress_id, account_id: checkSO.account_id }).limit(1).toArray()
                    
                    console.log('billingAddressCheck=', billingAddressCheck)
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
                
                const SOOutstandingAmt = checkSO.totalAmt - checkSO.billedAmt
                if (SOOutstandingAmt < args.chargeAmt) {
                    throw new ctx.err({message: "INVALID", data: {chargeAmt: args.chargeAmt }})
                }
                
                //3. add/mod fields
                args['version'] = "1"
                args['createBy_id'] = ctx.req.user._id
                args['updateBy_id'] = ctx.req.user._id
                args['createDateTime'] = moment().toDate()
                args['updateDateTime'] = moment().toDate()
                args['status'] = 'PENDING'
                args['printCount'] = 0
                args['docEvent_id'] = []
                args['paidAmt'] = 0
                
                //4. query & return
                
                const a = await ctx.db['p001'].collection('Invoice').insertOne(args);
                const e = await ctx.db['p001'].collection('DocEvent').insertOne({
                    docType: 'Invoice',
                    docEventType: 'CREATE',
                    doc_id: a.ops[0]['_id'],
                    msg: 'Invoice amount $' + args.chargeAmt,
                    user_id: ctx.req.user._id,
                    userName: ctx.req.user.firstName + ' ' + ctx.req.user.lastName,
                    createDateTime: moment().toDate()
                })
                const SOUpdate = await ctx.db['p001'].collection('SalesOrder').findOneAndUpdate(
                    {_id: args.salesOrder_id},
                    {$set: {
                        updateBy_id: ctx.req.user._id,
                        updateDateTime: moment().toDate()},
                    $inc: {
                        billedAmt: args.chargeAmt},
                    $push: {
                        invoiceList_id: a.ops[0]['_id'],
                        docEvent_id: e.ops[0]['_id']}
                    }
                )
                const invoiceUpdate = await ctx.db['p001'].collection('Invoice').findOneAndUpdate(
                    {_id: a.ops[0]['_id']},
                    {$push: {
                        docEvent_id: e.ops[0]['_id']}
                    },
                    {returnOriginal: false}
                )
                return invoiceUpdate.value
            } catch(e) { throw e }
        }
    },
    Invoice: {
        billingAddress: (obj) => { return obj.bllingAddress }
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