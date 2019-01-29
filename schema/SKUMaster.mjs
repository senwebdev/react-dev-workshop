import _ from 'lodash'
import { isAdmin } from '../auth/auth.mjs'

export const SKUType = ['CONTAINER', 'SHIPPING']

export const typeDef = `
    
    enum SKUType {
        CONTAINER
        SHIPPING
    }
    
    enum rentMode {
        DAY
        MONTH
        YEAR
    }
    
    extend type Query {
        getSKUMaster(where: queryWhere, limit: Int, offset: Int, orderBy: String, orderDirection: orderDirection): [SKUMaster]
    }
    
    extend type Mutation {
        "need admin"
        addSKUMaster(SKUType: SKUType!, shortCode: String!, rentMode: rentMode!, name: String!, longDesc: String!, iconPicURL: String!, smallPicURL: String!, largePicURL: String!, lengthM: Float!, widthM: Float!, heightM: Float!): SKUMaster
        
        "need admin"
        updateSKUMaster(_id: String!, op: updateOp!, shortCode: String, rentMode: rentMode, name: String, longDesc: String, iconPicURL: String, smallPicURL: String, largePicURL: String, lengthM: Float, widthM: Float, heightM: Float, isActive: Boolean): SKUMaster
    }
    
    type SKUMaster {
        _id: ID!,
        
        SKUType: SKUType,
        
        "A human readable code for a container type"
        shortCode: String,
        
        "Long name/description"
        name: String,
        
        "Long description in markdown format"
        longDesc: String,
        
        "size 100 x 100"
        iconPicURL: String,
        
        "size 500 x 500"
        smallPicURL: String,
        
        "size 2000 x 2000"
        largePicURL: String,
        
        lengthM: Float,
        widthM: Float,
        heightM: Float,
        isActive: Boolean!
    }`
    
export const resolver = {
    Query: {
        getSKUMaster: async (obj, args, ctx, info) => {
            try {
                //1. check for access requirement
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                let [q, stripped_args] = ctx.evalParam['p001'](ctx.db['p001'].collection('SKUMaster'), args)
                //4. query & return
                const doc =  await q.toArray()
                return doc
            } catch(e) { throw e }
        },
    },
    Mutation: {
        addSKUMaster: async (obj, args, ctx, info) => {
            //#4 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                args['isActive'] = true
                //4. query & return
                const a = await ctx.db['p001'].collection('SKUMaster').insertOne(args);
                return a.ops[0]
            } catch(e) { throw e }
        },
        updateSKUMaster: async (obj, args, ctx, info) => {
            //#5 Fixme add checking mechanism here
            try {
                //1. check for access requirement
                isAdmin(ctx)
                //2. field checking
                //3. add/mod fields
                ctx.spFunction['p001'].convertArgs(args)
                const id = args._id
                const op= args.op
                let update_fields = _.omit(_.omit(args, '_id'), 'op')
                //4. query & return
                const doc = await ctx.db['p001'].collection('SKUMaster').findOneAndUpdate({_id: id }, getUpdateField(op, update_fields), {returnOriginal: false})
                return doc.value
            } catch(e) { throw e }
        }
    },
    Container: {
        containerType_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('SKUMaster').findOne({_id: obj.containerType_id})
                return doc
            } catch(e) { throw e }
        }
    },
    PriceList: {
        SKU_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('SKUMaster').findOne({_id: obj.SKU_id})
                return doc
            } catch(e) { throw e }
        }
    },
    QuotationDetails: {
        SKU_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('SKUMaster').findOne({_id: obj.SKU_id})
                return doc
            } catch(e) { throw e }
        }
    },
    RentalOrderDetails: {
        SKU_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('SKUMaster').findOne({_id: obj.SKU_id})
                return doc
            } catch(e) { throw e }
        }
    }
}

export const typeDefPublic = `
    
    enum SKUType {
        CONTAINER
        SHIPPING
    }
    
    enum rentMode {
        DAY
        MONTH
        YEAR
    }
    
    type SKUMaster {
        _id: ID!,
        
        SKUType: SKUType,
        
        "A human readable code for a container type"
        shortCode: String,
        
        "Long name/description"
        name: String,
        
        "Long description in markdown format"
        longDesc: String,
        
        "size 100 x 100"
        iconPicURL: String,
        
        "size 500 x 500"
        smallPicURL: String,
        
        "size 2000 x 2000"
        largePicURL: String,
        
        lengthM: Float,
        widthM: Float,
        heightM: Float,
        isActive: Boolean!
    }`

export const resolverPublic = {
    PriceList: {
        SKU_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('SKUMaster').findOne({_id: obj.SKU_id})
                return doc
            } catch(e) { throw e }
        }
    },
    QuotationDetails: {
        SKU_id: async (obj, args, ctx, info) => {
            try {
                const doc = await ctx.db['p001'].collection('SKUMaster').findOne({_id: obj.SKU_id})
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