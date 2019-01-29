import _ from 'lodash'
import moment from 'moment'
import { isStaff, isTargetUser, isAdmin, isActiveUser, isTargetUserOrStaff, isAcctOwnerManager }  from '../auth/auth.mjs'

import { addDocEvent } from './DocEvent.mjs'
import { checkPriceListExpiry } from './PriceList.mjs'

const addQuotation= async (obj, args, ctx, info, apiName) => {
    //accept a list of priceList_id with qty
    //together with account_id
    
    //check account_id is own/manager by user
    //for each item in priceList, check priceList_id, get code, and compare with account.priceList
    //if all ok, add to quotation line and add amt to quotation.totalAmt
    
    try {
        console.log('addQuotation, start')
        //2. field checking
        console.log(args)
        
        let account
        const now = moment().toDate()
        const priceListItemInQuote = args.quotationLines.map(n => n.priceList_id)
        
        switch(apiName) {
            case 'gql':
                account = await ctx.db['p001'].collection('Account').findOne({_id: args.account_id})
                break
                
            case 'gqlPublic':
                account = {
                    _id: undefined,
                    accountType: undefined,
                    priceList: 'DEFAULT'
                }
                break
        }
        
        //get all priceList items from db that is active, in valid period, belongs to pricelist of account, and requested by mutation
        //fixme this is not 100% check yet, e.g. allowAcct, allowAccountType, etc, are still not checked.  To fix later
        let priceLists
        if (args.couponCode!=undefined) {
            priceLists= await ctx.db['p001'].collection('PriceList').find({_id: {$in: priceListItemInQuote}, code: args.couponCode, isActive: true, validFrom: {$lte: now}, validTo: {$gte: now}}).toArray()
        }
        else {
            priceLists =await ctx.db['p001'].collection('PriceList').find({_id: {$in: priceListItemInQuote}, code: account.priceList, isActive: true, validFrom: {$lte: now}, validTo: {$gte: now}}).toArray()
        }
        
        let quotation_details = []
        let totalPrice = 0
        for(let i=0; i<args.quotationLines.length; i++) {
            //find the priceList doc from db
            const p = priceLists.find( v => v._id.equals(args.quotationLines[i].priceList_id))
            
            if (p===undefined) {
                console.log(args.quotationLines[i].priceList_id, priceLists)
                throw new ctx.err({message: "INVALID", data: {quotationLines: args.quotationLines[i].priceList_id} })
            }
            
            const line_price = p.rent * args.quotationLines[i].qty
            totalPrice = totalPrice + line_price
            
            quotation_details.push({
                priceList_id: p._id,
                SKU_id: p.SKU_id,
                qty: args.quotationLines[i].qty,
                rentMode: p.rentMode,
                duration: p.duration,
                rent_unitPrice: p.rent,
                rent_lineTotal: line_price,
                remarks: args.quotationLines[i].remarks
            })
            
            
        }
        //3. add/mod fields
        const quotation = {
            version: '1.0',
            status: 'INIT',
            printCount: 0,
            quotationDetails: quotation_details,
            docEvent_id: [],
            account_id: account._id,
            accountType: account.accountType,
            priceList: args.couponCode ? args.couponCode : account.priceList,
            totalPrice: totalPrice,
            createDateTime: now,
            updateDateTime: now,
            createBy_id: (apiName=='gql'? ctx.req.user._id : undefined),
            updateBy_id: (apiName=='gql'? ctx.req.user._id : undefined)
        }
        //4. query & return
        //insert Quotation
        let doc_quotation = await ctx.db['p001'].collection('Quotation').insertOne(quotation);
        doc_quotation = doc_quotation.ops[0]
        
        //create docEvent
        let doc_event = await addDocEvent(obj, {docType: 'Quotation', docEventType: 'CREATE', doc_id: doc_quotation._id, msg: ''}, ctx, info)

        return doc_quotation
        
    } catch(e) { throw e }
}

//Custom schema
export const typeDef = `
    enum quotationStatus {
        INIT
        CONVERTED_SO
        HOLD
        CANCELLED
    }
    
    extend type Query {
        getQuotation(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [Quotation]
        
        "This is for p001-client use"
        getQuotationById(_id: String): Quotation
    }
    
    extend type Mutation {
        addQuotation(account_id: String!, quotationLines: [quotationLines!]!, couponCode: String): Quotation
    }
    
    input quotationLines {
        priceList_id: String!,
        qty: Int!,
        remarks: String
    }
    
    type Quotation {
        _id: ID!,
        version: String!,
        status: quotationStatus!,
        printCount: Int,
        docEvent_id: [DocEvent],
        account_id: Account,
        createDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime,
        createBy_id: User,
        updateBy_id: User,
        
        quotationDetails: [QuotationDetails],
        
        "Customer type.  Not price list code"
        accountType: String,
        
        "Price List"
        priceList: String,
        
        totalPrice: Float
    }
    
    type QuotationDetails {
        priceList_id: PriceList!,
        SKU_id: SKUMaster!,
        qty: Int!,
        rentMode: rentMode!,
        duration: Int!,
        
        rent_unitPrice: Float!,
        rent_lineTotal: Float!,
        
        remarks: String

    }`

export const resolver = {
    Query: {
        getQuotation: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                isStaff(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('Account'), args)
                //4. query & return
                const doc = await q.toArray()
                return doc
            } catch(e) { throw e }
        },
        getQuotationById: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                console.log('Quotation.getQuotationById')
                if (args._id=='' || args._id==undefined) { return {} }
                //2. field checking
                ctx.spFunction['p001'].convertArgs(args)
                const quotation = await ctx.db['p001'].collection('Quotation').findOne({_id: args._id, status: 'INIT'})
                
                if (quotation===null) {
                    throw new ctx.err({message: "NOT_FOUND", data: {quotation_id: args._id}})
                }
                
                //user must be account owner/manager of the quotation.  But if account_id==null, means quotation created before user login, so it can be accessed by everyone, thus skip checking
                if (quotation.account_id!=null) {
                    isAcctOwnerManager(ctx, quotation.account_id)
                }
                
                const priceListIsValid = checkPriceListExpiry(quotation.priceList)
                if (!priceListIsValid) {
                    throw new ctx.err({message: "EXPIRED", data: {quotation_id: args._id}})
                }
                
                //3. add/mod fields
                //4. query & return
                return quotation
            } catch(e) { throw e } //NOT_AUTHORIZED
        }
    },
    Mutation: {
        addQuotation: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                ctx.spFunction['p001'].convertArgs(args)
                args.quotationLines.forEach(v => ctx.spFunction['p001'].convertArgs(v))
                
                const a= await addQuotation(obj, args, ctx, info, 'gql')
                return a
            } catch(e) { throw e }
        }
    }
}

export const typeDefPublic = `
    enum quotationStatus {
        INIT
        CONVERTED_SO
        HOLD
        CANCELLED
    }
    
    extend type Mutation {
        addQuotation(account_id: String!, quotationLines: [quotationLines!]!, couponCode: String): Quotation
    }
    
    input quotationLines {
        priceList_id: String!,
        qty: Int!,
        remarks: String
    }
    
    type Quotation {
        _id: ID!,
        version: String!,
        status: quotationStatus!,
        printCount: Int,
        docEvent_id: [String],
        account_id: Account,
        createDateTime: GraphQLDateTime,
        updateDateTime: GraphQLDateTime,
        createBy_id: User,
        updateBy_id: User,

        quotationDetails: [QuotationDetails],
        
        "Customer type.  Not price list code"
        accountType: String,
        
        "Price List"
        priceList: String,
        
        totalPrice: Float
    }
    
    type QuotationDetails {
        priceList_id: PriceList!,
        SKU_id: SKUMaster!,
        qty: Int!,
        rentMode: rentMode!,
        duration: Int!,
        
        rent_unitPrice: Float!,
        rent_lineTotal: Float!,
        
        remarks: String
    }`

export const resolverPublic = {
    Mutation: {
        addQuotation: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                args.quotationLines.forEach(v => ctx.spFunction['p001'].convertArgs(v))
                
                const a= await addQuotation(obj, args, ctx, info, 'gqlPublic')
                return a
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