import _ from 'lodash'
import moment from 'moment'
import Stripe from 'stripe'

import { isAcctOwnerManager }  from '../auth/auth.mjs'
import {sleep} from '../util/sleep.mjs'
import sendMail from '../util/sendMail.mjs'

import { addDocEvent } from './DocEvent.mjs'

import { ROAddUpdateInvoice } from './RentalOrder.mjs'

const stripe = Stripe(process.env.STRIPE_KEY)

export const chargeStatus = ['PENDING', 'SETTLED', 'HOLD', 'CANCELLED']
export const chargeType = ['STRIPE_API', 'BANK', 'STRIPE_MANUAL', 'CASH', 'BALANCE']

//this function does not know about invoice order etc.  Therefore it shouold never be called individually.
//Always call from addInvoice, so as to make sure relative docs are properly updated
export const addCharge = async (obj, {invoice, invoice_id, chargeAmt, chargeType='STRIPE_API', account, chargeNow}, ctx, info) => {
    
    console.log('Charge.addCharge')
    //make sure invoice is available
    if (invoice==undefined) {
        if (invoice_id==undefined) {
            throw new ctx.err({message: "INVALID", data: {invoice_id: invoice_id}})
        }
        
        //FIXME update to support charging multi invoice
        invoice = await ctx.db['p001'].collection('Invoice').find({_id: invoice_id}).limit(1).toArray()
        if (invoice.length<1) {
            throw new ctx.err({message: "INVALID", data: {invoice_id: invoice_id}})
        }
    }
    
    //if chargeAmt > outstanding amt, throw error.  If chargeAmt not provided, charge all outstanding amount of the invoice
    const invoiceOutstandingAmt = invoice.totalAmt - invoice.settledAmt
    if (chargeAmt!=undefined) {
        if (chargeAmt > invoiceOutstandingAmt) {
            throw new ctx.err({message: "INVALID", data: {chargeAmt: chargeAmt}})
        }
    }
    else { chargeAmt = invoiceOutstandingAmt }
    
    //get account either from args, or from invoice.account_id.  Also verify request user have right to create charge
    if (account == undefined) {
        account = await ctx.db['p001'].collection('Account').find({_id: invoice.account_id}, {_id: 1, stripeCustomerObject: 1}).limit(1).toArray()
    }
    isAcctOwnerManager(ctx, account._id)
    
    let now = moment().toDate()
    let charge_args = {
        version: '1.0',
        status: 'PENDING',
        type: chargeType,
        invoice_id: [invoice._id],
        createDateTime: now,
        updateDateTime: now,
        createBy_id: ctx.req.user._id,
        updateBy_id: ctx.req.user._id,
        remarks: '',
        totalAmt: chargeAmt,
        settlementRef: '',
        chargeLog_id: [],
        tryCount: 0
    }
    
    let doc_charge = await ctx.db['p001'].collection('Charge').insertOne(charge_args)
    doc_charge = doc_charge.ops[0]
    
    if (chargeType=='STRIPE_API') {
        let retryCount = 0, success = false, retry = true, ref = '', chargeLogIdList = [], chargeStatus = 'CANCELLED', err = undefined
        
        //start sending request to Stripe server, max retry 3 times
        while ((retryCount < 3) & (retry == true)) {
            
            ({success, retry, ref, err} = await stripeAPIChargeAttempt({
                ctx: ctx,
                chargeId: doc_charge._id,
                cusObj: account.stripeCustomerObject,
                amt: chargeAmt
            }))
            
            if (success) { chargeStatus = 'SETTLED' }
            
            chargeLogIdList.push(ref)
            retryCount+=1
            if (retry==true) {
                await sleep(1000)
            }
        }
        
        //whatever if it's success or failed, update Charge with relevant info
        doc_charge = await ctx.db['p001'].collection('Charge').findOneAndUpdate(
            {_id: doc_charge._id},
            {
                $set: {status: chargeStatus, updateDateTime: moment().toDate(), tryCount: retryCount},
                $push: {chargeLog_id: chargeLogIdList }
            },
            {returnOriginal : false}
        )
        doc_charge = doc_charge.value
        console.log('addChange, doc_charge=')
        
        return {chargeDoc: doc_charge, chargeErr: err}
    }

        /*catch(e) { 
            console.log('Charges.addChargehave error!', e)
            const err = handleStripeErr(e)
            console.log('err processed, err=', err)
            switch (err.handle) {
                case 'throw':
                    throw ctx.err({message: "SPECIAL", data: {msg: err.message}})
                case 'retry':
                    if (stripeRetry>=5) {
                        throw ctx.err({message: "SPECIAL", data: {msg: 'There are unexpected error with card processing.  Your card is not charged yet, we will handle your case with high priority and will contact you very soon!'}})
                    }
                    await sleep(1000)
                    
                    return addCharge(ctx, {invoice: invoice, chargeAmt: chargeAmt, chargeType: chargeType, account: account, stripeRetry: stripeRetry+1}, ctx, info)
                default:
                    throw ctx.err({message: "SPECIAL", data: {msg: 'An unknown error occured.  Please contact us.'}})
            }
        }
    }*/
    //if charge type not = 'STRIPE_API', currently it's all manual
}

const stripeAPIChargeAttempt = async ({ctx, chargeId, cusObj, amt}) => {
    try {
        //chargeAmt * 100 coz stripe change in cents
        const stripeCharge = await stripe.charges.create({
            customer: cusObj.id,
            amount: amt * 100,
            currency: 'hkd',
            statement_descriptor: 'WISEKEEP SERV CHG'
        })
        console.log('stripeAPIChargeAttempt.stripeCharge created, return=', stripeCharge)
        
        const settlementRef = JSON.stringify(stripeCharge)
        
        if (stripeCharge.status=='succeeded') {
            let logDoc = await ctx.db['p001'].collection('ChargeLog').insertOne({
                charge_id: chargeId,
                status: 'success',
                chargeTime: moment().toDate(),
                chargeRef: settlementRef
            })
            return {success: true, retry: false, ref: logDoc.ops[0]._id}
        }
        else {
            //if error not thrown, but status != succeeded, something strange happened, still log it down
            let logDoc = await ctx.db['p001'].collection('ChargeLog').insertOne({
                charge_id: chargeId,
                status: 'haveIssue',
                chargeTime: moment().toDate(),
                chargeRef: settlementRef
            })
            sendMail('chargeError', {
                chargeLogId: logDoc.ops[0]._id,
                chargeDoc: logDoc.ops[0]
            })
            
            return {success: false, retry: false, ref: logDoc.ops[0]._id}
        }
    }
    catch(e) { 
        console.log('Charges.addCharge have error!', e)
        let logDoc = await ctx.db['p001'].collection('ChargeLog').insertOne({
            charge_id: chargeId,
            status: 'error',
            chargeTime: moment().toDate(),
            chargeRef: e
        })
        sendMail('chargeError', {
            chargeLogId: logDoc.ops[0]._id,
            chargeDoc: e
        })
        const err = handleStripeErr(e)
        console.log('err processed, err=', err)
        return {success: false, retry: (err.handle=='retry'), ref: logDoc.ops[0]._id, err: err}
    }
}

export const handleStripeErr = (e)=> {
    switch (e.type) {
        case 'StripeCardError':
        // A declined card error
            return {handle: 'throw', message: e.message} // => e.g. "Your card's expiration year is invalid."
        
        case 'RateLimitError':
            return {handle: 'retry', message: e.message}
        // Too many requests made to the API too quickly
        
        case 'StripeInvalidRequestError':
        // Invalid parameters were supplied to Stripe's API
            return {handle: 'throw', message: 'There are unexpected error with card processing.  Your card is not charged yet, we will handle your case with high priority and will contact you very soon!'}

        case 'StripeAPIError':
        // An error occurred internally with Stripe's API
            return {handle: 'throw', message: 'There are unexpected error with card processing.  Your card is not charged yet, we will handle your case with high priority and will contact you very soon!' }

        case 'StripeConnectionError':
        // Some kind of error occurred during the HTTPS communication
            return {handle: 'throw', message: 'There are unexpected error with card processing.  Your card is not charged yet, we will handle your case with high priority and will contact you very soon!' }

        case 'StripeAuthenticationError':
        // You probably used an incorrect API key
            return {handle: 'throw', message: 'There are unexpected error with card processing.  Your card is not charged yet, we will handle your case with high priority and will contact you very soon!' }
        
        default:
        // Handle any other types of unexpected errors
            return {handle: 'throw', message: 'There are unexpected error with card processing.  Your card is not charged yet, we will handle your case with high priority and will contact you very soon!' }
    }
}

export const typeDef = `
    
    enum ChargeStatus {
        PENDING
		SETTLED
        HOLD
        CANCELLED
    }
    
    enum ChargeType {
    	STRIPE_API
    	STRIPE_MANUAL
    	BANK
    	CASH
    	BALANCE
    }
    
    type Charge {
        _id: ID!,
        version: String!,
        status: ChargeStatus!,
        type: ChargeType!,
        invoice_id: [Invoice],
        createDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime,
        createBy_id: User,
        updateBy_id: User,
        
        remarks: String,
        
        totalAmt: Float,
        settlementRef: String
    }
    
    type ChargeList {
        _id: ID!,
        status: ChargeStatus!,
        type: ChargeType!,
        totalAmt: Float
    }`


export const resolver = {
	
}