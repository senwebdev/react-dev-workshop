import _ from 'lodash'
import moment from 'moment'
import { isAdminOrSU, isAcctOwnerManager } from '../auth/auth.mjs'
import {getIdObj} from '../db/p001.mjs'


export const checkPriceListExpiry = async (ctx, code, targetDate = moment().toDate()) => {
    try {
        const p = await ctx.db['p001'].collection('PriceList').find({code: code, isActive: true, validFrom: {$lte: targetDate}, validTo: {$gte: targetDate}}).limit(1).count()
        return (p==1)
    } catch(e) { throw e }
}

export const typeDef = `
    
    extend type Query {
        getPriceList(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [PriceList]
        
        getPriceListByAccount(account_id: String): [PriceList]
        getPriceListByCode(code: String, account_id: String): [PriceList]
    }
    
    input ItemPrice {
        SKU_id: String!,
        
        rent: Float,
        
        ship_in_base: Float!,
        ship_in_perPiece: Float!,
        ship_out_base: Float!,
        ship_out_perPiece: Float!,
        ship_first_base: Float!,
        ship_first_perPiece: Float!,
        ship_last_base: Float!,
        ship_last_perPiece: Float!
    }

    extend type Mutation {
        "need admin"
        addPriceList( code: String!, itemPrice: [ItemPrice!]! ): [PriceList]
        
        "need admin"
        updatePriceList(
            _id: String!,
            rent: Float,
            ship_in_base: Float,
            ship_in_perPiece: Float,
            ship_out_base: Float,
            ship_out_perPiece: Float,
            ship_first_base: Float,
            ship_first_perPiece: Float,
            ship_last_base: Float,
            ship_last_perPiece: Float
        ): PriceList
    }
    
    type PriceList {
        _id: ID!,
        "Price List Name"
        code: String!,
        "If true, code can be entered at frontend as couponCode, false means only as a price list"
        isCoupon: Boolean!,
        allowAccountType: [accountType],
        allowAcct_id: [Account],
        "If true, allow users without account to retrieve this price list"
        allowPublic: Boolean!,
        
        
        "For describing the price structure, and promotional wordings.  Support markdown"
        desc: String,
        SKU_id: SKUMaster!,
        
        "DAY, MONTH, YEAR"
        rentMode: rentMode,
        
        rent: Float!,
        duration: Int!,
        ship_in_base: Float!,
        ship_in_perPiece: Float!,
        ship_out_base: Float!,
        ship_out_perPiece: Float!,
        ship_first_base: Float!,
        ship_first_perPiece: Float!,
        ship_last_base: Float!,
        ship_last_perPiece: Float!,
        
        isActive: Boolean!,
        validFrom: GraphQLDate,
        validTo: GraphQLDate,
    }`
    
export const resolver = {
    Query: {
        getPriceList: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('PriceList'), args)
                //4. query & return
                const doc =  await q.toArray()
                return doc
            } catch(e) { throw e }
        },
        getPriceListByAccount: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //Only extract account that are own/manager.  View account excl. since they cannot buy anyway
                console.log('gql.PriceList.getPriceListByAccount')
                let priceListCode = 'DEFAULT'
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                //3. add/mod fields
                
                //if account_id is provided, check if user own/mange acct, then get priceList code.  If account_id not provided, give default price list
                console.log('args.account_id=', args.account_id)
                if (args.account_id) {
                    isAcctOwnerManager(ctx, args.account_id)
                    const a = await ctx.db['p001'].collection('Account').findOne({_id: args.account_id}, {projection: {_id: 0, priceList: 1}})
                    priceListCode = a.priceList
                }
                
                const now = moment().toDate()
                //4. query & return
                const priceLists = await ctx.db['p001'].collection('PriceList').find({code: priceListCode, isActive: true, validFrom: {$lte: now}, validTo: {$gte: now}}).toArray()
                console.log('accts=',priceLists)
                return priceLists

            } catch(e) { throw e }
        },
        getPriceListByCode: async (obj, args, ctx, info) => {
            //this is only used for coupon code.  Therefore can only retrieve price list that isCoupon = true
            console.log('gql.PriceList.getPriceListByCode')
            ctx.spFunction['p001'].convertArgs(args)
            
            const now = moment().toDate()
            const docs = await ctx.db['p001'].collection('PriceList').find({code: args.code, isActive: true, validFrom: {$lte: now}, validTo: {$gte: now}, isCoupon: true}).toArray()
            
            //if nothing returned directly give error
            if (docs.length == 0) { throw new ctx.err({message: "NOT_FOUND", data: {code: args.code }}) }
            console.log(docs[0])
            
            //if restriction applies...
            if (docs[0].allowAcct_id) {
                let checkAcctId = false
                for(let i=0; i<docs[0].allowAcct_id.length; i++) {
                    
                    //check if array in price list = user's acct_id
                    if (docs[0].allowAcct_id[i].equals(args.account_id)) {
                        checkAcctId = true
                        break
                    }
                }
                
                //throw "NOT_FOUND" to mask the real reason to end user.  No need to let them know they are unauthorized
                if (!checkAcctId) { throw new ctx.err({message: "NOT_FOUND", data: {code: args.code }}) }
            }
            
            if (docs[0].allowAccountType) {
                
                const a = await ctx.db['p001'].collection('Account').findOne({_id: args.account_id}, {projection: {_id: 0, accountType: 1}})
                if (!docs[0].allowAccountType.includes(a.accountType)) {
                    throw new ctx.err({message: "NOT_FOUND", data: {code: args.code }})
                }
            }
            
            console.log(docs)
            
            return docs
        },
    },
    Mutation: {
        addPriceList: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                ctx.spFunction['p001'].convertArgs(args)
                //2. field checking
                const priceListCheck = await ctx.db['p001'].collection('PriceList').find({code:args.code}).limit(1).count(true)
                if (priceListCheck==1) {
                    throw new ctx.err({message: "KEY_EXIST", data: {code: args.code} })
                }
                //3. add/mod fields
                let docs = []
                const validFrom = moment('1900-01-01').toDate()
                const validTo = moment('9999-12-31').toDate()
                for (let i = 0; i < args.itemPrice.length; i++) {
                    ctx.spFunction['p001'].convertArgs(args.itemPrice[i])
                    docs.push(_.merge({
                        code: args.code,
                        isActive: true,
                        validFrom: validFrom,
                        validTo: validTo
                    }, args.itemPrice[i]))
                }
                //4. query & return
                const a = await ctx.db['p001'].collection('PriceList').insertMany(docs);
                return a.ops
            } catch(e) { throw e }
        },
        updatePriceList: async (obj, args, ctx, info) => {
            //#5 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdminOrSU(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                const id = args._id
                let update_fields = _.omit(args, '_id')
                //4. query & return
                const doc = await ctx.db['p001'].collection('PriceList').findOneAndUpdate({_id: id }, {$set: update_fields}, {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        }
    },
    Account: {
        priceList: async (obj, args, ctx, info) => {
            try {
                if (obj.priceList===null) { return null }
                const docs = await ctx.db['p001'].collection('PriceList').find({code: obj.priceList, isActive: true}).toArray()
                return docs
            } catch(e) { throw e }
        }
    },
    QuotationDetails: {
        priceList_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('PriceList').findOne({_id: obj.priceList_id})
                if (doc.isActive===true) { return doc }
                else { throw new ctx.err({message: "NOT_FOUND", data: {priceList_id: obj.priceList_id }}) }
            } catch(e) { throw e }
        }
    }
}

export const typeDefPublic = `


    extend type Query {
        "Public version, whatever account_id provided, it will send back DEFAULT price list"
        getPriceListByAccount(account_id: String): [PriceList]
        getPriceListByCode(code: String, account_id: String): [PriceList]
    }
    
    type PriceList {
        _id: ID!,
        code: String!,
        
        "For describing the price structure, and promotional wordings.  Support markdown"
        desc: String,
        SKU_id: SKUMaster!,
        
        rent: Float!,
        duration: Int!,
        "DAY, MONTH, YEAR"
        rentMode: rentMode,
        
        ship_in_base: Float!,
        ship_in_perPiece: Float!,
        ship_out_base: Float!,
        ship_out_perPiece: Float!,
        ship_first_base: Float!,
        ship_first_perPiece: Float!,
        ship_last_base: Float!,
        ship_last_perPiece: Float!,
        
        isActive: Boolean!,
        validFrom: GraphQLDate,
        validTo: GraphQLDate,
    }`

export const resolverPublic = {
    Query: {
        getPriceListByAccount: async (obj, args, ctx, info) => {
            console.log('gqlPublic.PriceList.getPriceListByAccount')
            const now = moment().toDate()
            const docs = await ctx.db['p001'].collection('PriceList').find({code: 'DEFAULT', isActive: true, validFrom: {$lte: now}, validTo: {$gte: now}}).toArray()
            console.log(docs)
            return docs
        },
        getPriceListByCode: async (obj, args, ctx, info) => {
            //this is only used for coupon code.  Therefore can only retrieve price list that isCoupon = true
            console.log('gql.PriceList.getPriceListByCode')
            
            const now = moment().toDate()
            const docs = await ctx.db['p001'].collection('PriceList').find({code: args.code, isActive: true, validFrom: {$lte: now}, validTo: {$gte: now}, isCoupon: true, allowPublic: true}).toArray()
            
            //if nothing returned directly give error
            if (docs.length == 0) { throw new ctx.err({message: "NOT_FOUND", data: {code: args.code }}) }
            
            //no need to check allowAcct_id and allowAccountType, as this is public channel
            
            console.log(docs)
            
            return docs
        }
    },
    QuotationDetails: {
        priceList_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('PriceList').findOne({_id: obj.priceList_id})
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