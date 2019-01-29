import bcrypt from 'bcryptjs'
import { getIdObj, convertArgs } from '../db/p001.mjs'
import _ from 'lodash'

export const customerRoleList = ['USER', 'VIP', 'SVIP']
export const staffRoleList = ['ADMIN', 'COURIER', 'BOSS', 'SU']
export const roleList = customerRoleList.concat(staffRoleList)

//this is mainly for use by resolver, to simply access right checking
export const isStaff = (ctx) => {
    try {
        if (!(ctx.req.isAuthenticated()& checkRoleOR(ctx.req.user, staffRoleList)& (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
//id can be array of string or string.  Will do a OR match if it's array of string
export const isTargetUser = (ctx, id) => {
    try {
        let match_ok = false
        id = _.compact(id)
        if (Array.isArray(id)) { 
            console.log('array', id.length)
            for(let i=0; i<id.length; i++) {
                console.log('a=', id[i], ' b=',ctx.req.user._id, ' equals=',id[i].equals(ctx.req.user._id))
                if (id[i].equals(ctx.req.user._id)) {
                    match_ok = true
                    break
                }
            }
        }
        else {
            console.log('else')
            match_ok = (ctx.req.user._id.equals(id)) }
        
        if (!(ctx.req.isAuthenticated()& match_ok & (ctx.req.user.isActive==true))) { 
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
//id can be array of string or string.  Will do a OR match if it's array of string
export const isTargetUserOrStaff = (ctx, id) => {
    try {
        let match_ok = false
        id = _.compact(id)
        if (Array.isArray(id)) { 
            for(let i=0; i<id.length; i++) {
                if (id[i].equals(ctx.req.user._id)) {
                    match_ok = true
                    break
                }
            }
        }
        else { match_ok = (ctx.req.user._id.equals(id)) }
        if (!(ctx.req.isAuthenticated()& (match_ok |checkRoleOR(ctx.req.user, staffRoleList)) & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isSU = (ctx) => {
    try {
        if (!(ctx.req.isAuthenticated()& checkRole(ctx.req.user, 'SU') & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isAdmin = (ctx) => {
    try {
        if (!(ctx.req.isAuthenticated()& checkRole(ctx.req.user, 'ADMIN') & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isAdminOrSU = (ctx) => {
    try {
        if (!(ctx.req.isAuthenticated()& checkRoleOR(ctx.req.user, ['ADMIN', 'SU']) & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isActiveUser = (ctx) => {
    try {
        if (!(ctx.req.isAuthenticated() & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isAcctOwner = (ctx, acctId) => {
    try {
        let match_ok = false
        const acctList = ctx.req.user.accountOwn_id
        for(let i=0; i<acctList.length; i++) {
            if (acctId.equals(acctList[i])) {
                match_ok = true
                break
            }
        }
        if (!(ctx.req.isAuthenticated()& (match_ok) & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isAcctOwnerManager = (ctx, acctId) => {
    try {
        let match_ok = false
        const acctList = _.union(ctx.req.user.accountOwn_id, ctx.req.user.accountManage_id)
        for(let i=0; i<acctList.length; i++) {
            if (acctId.equals(acctList[i])) {
                match_ok = true
                break
            }
        }
        if (!(ctx.req.isAuthenticated()& (match_ok) & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}
//this is mainly for use by resolver, to simply access right checking
export const isAcctOwnerManagerViewer = (ctx, acctId) => {
    try {
        let match_ok = false
        const acctList = _.union(ctx.req.user.accountOwn_id, ctx.req.user.accountManage_id, ctx.req.user.accountView_id)
        for(let i=0; i<acctList.length; i++) {
            if (acctId.equals(acctList[i])) {
                match_ok = true
                break
            }
        }
        if (!(ctx.req.isAuthenticated()& (match_ok) & (ctx.req.user.isActive==true))) {
            throw new ctx.err({message: "NOT_AUTHORIZED"})
        } else { return true }
    } catch(e) {throw e}
}




//role is a String
export const checkRole = (u, role) => {
    var match = false
    for (let i=0; i< u.role.length; i++) {
        if (u.role[i] == role) {
            match = true
            break
        }
    }
    return match
}

//role is array of String
export const checkRoleAND = (u, role) => {
    var t
    for (let j=0; j< role.length; j++) {
        t = false
        for (let i=0; i< u.role.length; i++) {
            if (u.role[i] == role[j]) {
                t = true
                break
            }
        }
        if (!t) { return false }
    }
    return true
}

//role is array of String
export const checkRoleOR = (u, role) => {
    var match = false
    for (let i=0; i< u.role.length; i++) {
        for (let j=0; j< role.length; j++) {
            if (u.role[i] == role[j]) { return true }
        }
    }
    return false
}

//return a User object
export const authUserLocal = async (db, user, pw) => {
    try {
        console.log('authUserLocal called', user, pw)
        let userSearch = [{email: user}, {mobilePhone: user}]
        if (user.length===24) userSearch.push({_id: getIdObj(user)})
        const a = await db.collection('User').findOne({$or: userSearch})
        if (a===null) { throw "User not found" }
        if ((!a.isActive) | (a['isActive']===undefined)) { throw "Account suspended" }
        const pw_ok = await bcrypt.compare(pw, a.password)
        if (!pw_ok) { throw "Password is wrong" }
        console.log('authUserLocal success')
        return a._id
    } catch(e) { 
        console.log(e)
        throw e
    }
}

//id is String, not ObjectID
export const getUserById = async (db, id) => {
    try {
        const a = await db.collection('User').findOne({_id: getIdObj(id) })
        if (a===null) { throw "not found" }
        if (!a.isActive) { throw "suspended" }
        return a
    } catch(e) { throw e }
}

export const getAccountOwner = async (db, id) => {
    try {
        const a = await db.collection('Account').findOne({_id: getIdObj(id) })
        return a.owner_id
    } catch(e) { throw e }
}

export const getAccountOwnerManager = async (db, id) => {
    try {
        console.log('getAccountOwnerManager, id=', id)
        const a = await db.collection('Account').findOne({_id: getIdObj(id) })
        return _.union([a.owner_id], a.manager_id)
    } catch(e) { throw e }
}

export const getAccountOwnerManagerViewer = async (db, id) => {
    try {
        const a = await db.collection('Account').findOne({_id: getIdObj(id) })
        return _.union([a.owner_id], a.manager_id, a.viewer_id)
    } catch(e) { throw e }
}