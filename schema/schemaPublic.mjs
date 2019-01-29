import graphqlTools from 'graphql-tools'

import _ from 'lodash'

import {typeDefPublic as User_D, resolverPublic as User_R}  from './User.mjs'
import {typeDefPublic as SKUMaster_D, resolverPublic as SKUMaster_R}  from './SKUMaster.mjs'
import {typeDefPublic as PriceList_D, resolverPublic as PriceList_R}  from './PriceList.mjs'
import {typeDefPublic as Quotation_D, resolverPublic as Quotation_R}  from './Quotation.mjs'
import {typeDefPublic as Account_D, resolverPublic as Account_R}  from './Account.mjs'

const logger = { log: (e) => console.log(e) }

const rootTypeDef = `
    scalar GraphQLDate
    scalar GraphQLDateTime
    
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
        Email
        SMS
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
    }
    
    type Mutation {
        _empty: String
    }`

// The resolvers
export const rootResolver = {
}

// Put together a schema
export const schemaPublic = graphqlTools.makeExecutableSchema({
    typeDefs: [
        rootTypeDef,
        User_D,
        SKUMaster_D,
        PriceList_D,
        Quotation_D,
        Account_D
    ],
    resolvers: _.merge(
        rootResolver,
        User_R,
        SKUMaster_R,
        PriceList_R,
        Quotation_R,
        Account_R
    ),
  logger
});
