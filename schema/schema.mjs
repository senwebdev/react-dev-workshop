import graphqlTools from 'graphql-tools'
import graphISODate from 'graphql-iso-date'
import _ from 'lodash'

import {typeDef as WHS_D, resolver as WHS_R}  from './WHS.mjs'
import {typeDef as SKUMaster_D, resolver as SKUMaster_R}  from './SKUMaster.mjs'
import {typeDef as PriceList_D, resolver as PriceList_R}  from './PriceList.mjs'
import {typeDef as User_D, resolver as User_R}  from './User.mjs'
import {typeDef as Address_D, resolver as Address_R}  from './Address.mjs'
import {typeDef as DocEvent_D, resolver as DocEvent_R}  from './DocEvent.mjs'
import {typeDef as Account_D, resolver as Account_R}  from './Account.mjs'
import {typeDef as Container_D, resolver as Container_R}  from './Container.mjs'
import {typeDef as ContainerEvent_D, resolver as ContainerEvent_R}  from './ContainerEvent.mjs'
import {typeDef as ContainerUserInfo_D, resolver as ContainerUserInfo_R}  from './ContainerUserInfo.mjs'
import {typeDef as Quotation_D, resolver as Quotation_R}  from './Quotation.mjs'
import {typeDef as RentalOrder_D, resolver as RentalOrder_R}  from './RentalOrder.mjs'
import {typeDef as Invoice_D, resolver as Invoice_R}  from './Invoice.mjs'
import {typeDef as Charge_D, resolver as Charge_R}  from './Charge.mjs'
import {typeDef as PackingList_D, resolver as PackingList_R}  from './PackingList.mjs'
import {typeDef as DeliveryNote_D, resolver as DeliveryNote_R}  from './DeliveryNote.mjs'
import {typeDef as PickUpNote_D, resolver as PickUpNote_R}  from './PickUpNote.mjs'
import {typeDef as TransitNote_D, resolver as TransitNote_R}  from './TransitNote.mjs'
import {typeDef as Vehicle_D, resolver as Vehicle_R}  from './Vehicle.mjs'


const logger = { log: (e) => console.log(e) }

const GraphQLDate = graphISODate.GraphQLDate
const GraphQLDateTime = graphISODate.GraphQLDateTime

const rootTypeDef = `
    scalar GraphQLDate
    scalar GraphQLDateTime
    
    input docLines {
        SKU_id: String,
        container_id: String,
        qty: Int,
        qty_delivered: Int,
        rentMode: rentMode,
        unitTotal: Float,
        lineTotal: Float
    }
    
    enum userRoleType {
        USER
        VIP
        SVIP
    }
    
    enum orderDirection {
        ASC
        DESC
    }
    
    enum queryOp {
        EQ
        NE
        GTE
        LTE
        LIKE
        NLIKE
    }
    
    enum updateOp {
        SET
        INC
        UNSET
    }
    
    enum numOp {
        ADD
        SUB
    }
    
    enum Language {
        zhHK
        en
    }
    
    enum VerifiedContactMethod {
        SMS
        Email
    }
    
    input queryWhere {
        AND: [queryWhere!],
        OR: [queryWhere!],
        field: String,
        op: queryOp,
        filter: String
    }
    
    type Query { 
        _empty: String
        test(name: String!): [String]
    }
    
    type Mutation {
        _empty: String
    }`

// The resolvers
export const rootResolver = {
    Query: {
        test: async (obj, args, ctx, info) => {
            console.time('test1')
            const str1 = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ+-'
            const comlen = 4
            let array1 = []
            //split str1 into array of chars, put in array1
            for (let x = 0, y=1; x < str1.length; x++,y++) {
                array1[x]=str1.substring(x, y)
            }
            let combi = []
            let comIndex = []
            //create index for N position char, where N = comlen
            for (let j=0;j<comlen;j++) { comIndex[j] = 0 }
            comIndex[0] = 6
            comIndex[1] = 11
            comIndex[2] = 26
            comIndex[3] = 17
            
            while (comIndex[0] < str1.length ) {
                let t = ''
                for (let j=0; j<comlen;j++) {
                    t = t + array1[comIndex[j]]
                }
                comIndex[comlen-1]++
                for (let j=comlen-1; j>0; j--) {
                    if (comIndex[j] > str1.length-1) {
                        comIndex[j] = 0
                        comIndex[j-1]++
                    }
                }
                const c = await ctx.db['p001'].collection('IDList').insertOne({_id: t, score: parseInt((Math.random()*1000000000).toFixed(0)) })
                console.log(c.ops[0])
                //combi.push(t)
            }
            console.timeEnd('test1')
            console.time('shuffle')
            for (let i = combi.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [combi[i], combi[j]] = [combi[j], combi[i]];
            }
            console.timeEnd('shuffle')
           
            return ['a']
            
        }
    }
}

// Put together a schema
export const schema = graphqlTools.makeExecutableSchema({
    typeDefs: [
        rootTypeDef,
        Address_D,
        User_D,
        WHS_D,
        PriceList_D,
        Vehicle_D,
        Account_D,
        SKUMaster_D,
        Container_D,
        Quotation_D,
        RentalOrder_D,
        Invoice_D,
        Charge_D,
        DocEvent_D
    ],
    resolvers: _.merge(
        rootResolver,
        User_R,
        WHS_R,
        PriceList_R,
        Vehicle_R,
        Address_R,
        Account_R,
        SKUMaster_R,
        Container_R,
        Quotation_R,
        RentalOrder_R,
        Invoice_R,
        Charge_R,
        DocEvent_R
    ),
  logger
})


/*
    type DocumentLines {
        SKU_id: String,
        SKUName: String,
        containerList: [Container_subset],
        qty: Int,
        qty_delivered: Int,
        
        
        "Deliver Order / PickUp Order only"
        baseTotal: Float,
        "Deliver Order / PickUp Order only"
        perPieceTotal: Float,
        
        
        "Rental Order only"
        rentMode: rentMode,
        "Rental Order only"
        unitTotal: Float,
        "Rental Order only"
        lineTotal: Float
    }
*/