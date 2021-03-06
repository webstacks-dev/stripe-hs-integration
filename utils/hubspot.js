const axios = require('axios');
require('dotenv').config()

const getUserVID = async (userEmail) => {
    try {
        const res = await axios.get(`https://api.hubapi.com/contacts/v1/contact/email/${userEmail}/profile?hapikey=${process.env.HAPI_KEY}`)
        if (res.status === 200) {
            return res.data.vid
        } else return;
    } catch (e) {
        console.error("Could not find user VID");
    }
}

const createUser = async (userEmail, name) => {
    let names = name.split(' ') || []
    const firstName = names.splice(0, 1)[0] || ""
    const lastName = names.join(' ') || ""
    try {
        const reqBody = {
            "properties": [{
                "property": "email",
                "value": userEmail,
            }, {
                "property": "firstname",
                "value": firstName
            }, {
                "property": "lastname",
                "value": lastName
            }]
        }
        const res = await axios.post(`https://api.hubapi.com/contacts/v1/contact/?hapikey=${process.env.HAPI_KEY}`, reqBody, { 'Content-Type': 'application/json' })
        return res.data.vid
    } catch (e) {
        console.error("Could not create user VID", e)
    }
}

const createUserOptIn = async (email, firstName, lastName, opt_in) => {
    try {
        const reqBody = {
            "properties": [{
                "property": "email",
                "value": email,
            }, {
                "property": "firstname",
                "value": firstName
            }, {
                "property": "lastname",
                "value": lastName
            }, {
                "property": "text_message_opt_in",
                "value": opt_in
            }]
        }
        const res = await axios.post(`https://api.hubapi.com/contacts/v1/contact/?hapikey=${process.env.HAPI_KEY}`, reqBody, { 'Content-Type': 'application/json' })
        return res.data.vid
    } catch (e) {
        console.error("Could not create user VID", e)
    }
}

const updateContact = async (userVID) => {
    try {
        const reqBody = {
            "properties": [{
                "property": "text_message_opt_in",
                "value": true
            }]
        }
        await axios.post(`https://api.hubapi.com/contacts/v1/contact/vid/${userVID}/profile?hapikey=${process.env.HAPI_KEY}`, reqBody, { 'Content-Type': 'application/json' })
    } catch (e) {
        console.log("COULD NOT UPDATE CONTACT", e);
    }
}

const getContactDeals = async (userId) => {
    const dealsData = await axios.get(`https://api.hubapi.com/crm-associations/v1/associations/${userId}/HUBSPOT_DEFINED/4?hapikey=${process.env.HAPI_KEY}`)
    return dealsData.data.results // returns array of deal id's
}

const getDealData = async (dealId) => {
    try {
        const data = await axios.get(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}?hapikey=${process.env.HAPI_KEY}&properties=dfy_product_name&properties=referral_marketing_product&properties=authorify_product&properties=dealname&properties=pipeline`)
        return data.data // returns object of deal with deal properties
    } catch (e) {
        console.log(e);
    }
}

const associateContactToDeal = async (dealId, contactId) => {
    // CREATE HUBSPOT ASSOCIATION FROM CONTACT TO DEAL
    try {
        const associationRequest = {
            "fromObjectId": contactId,
            "toObjectId": dealId,
            "category": "HUBSPOT_DEFINED",
            "definitionId": 4
        }
        await axios.put(`https://api.hubapi.com/crm-associations/v1/associations?hapikey=${process.env.HAPI_KEY}`, associationRequest)
        console.log(`SUCCESFULLY ASSOCIATED DEAL ${dealId} AND CONTACT ${contactId}`);
    } catch (e) {
        console.log("ERROR: COULD NOT ASSOCIATE CONTACT TO DEAL");
    }
}

const handleStatus = (status) => {
    if (status === "trialing") {
        return "Trialing"
    } else if (status === "active") {
        return "Active"
    } else if (status === "canceled") {
        return "Cancelled"
    } else if (status === "past_due" || status === "unpaid" || status === "incomplete_expired" || status === "incomplete" || status === "expired" || status === "unpaid") {
        return "Failed"
    } else {
        return "Active"
    }
}

const createDeal = async (priceObj, name, status) => {
    const newStatus = handleStatus(status)
    try {
        const reqBody = {
            properties: {
                [priceObj.productProperty]: priceObj.product,
                [priceObj.priceProperty]: priceObj.value,
                dealname: `${name} - ${priceObj.name}`,
                pipeline: '6808662',
                dealstage: '6808663',
                status: newStatus,
                amount: priceObj.value
            }
        }
        const deal = await axios.post(`https://api.hubapi.com/crm/v3/objects/deals?hapikey=${process.env.HAPI_KEY}`, reqBody, { accept: 'application/json', 'content-type': 'application/json' })
        return deal.data.id
    } catch (e) {
        console.log("ERROR:", e);
    }
}

const getHubspotProducts = async (prods, offset) => {
    try {
        let url = `https://api.hubapi.com/crm/v3/objects/products?hapikey=${process.env.HAPI_KEY}&archived=false&limit=100&properties=name`
        if (offset) {
            url = `https://api.hubapi.com/crm/v3/objects/products?hapikey=${process.env.HAPI_KEY}&archived=false&limit=100&properties=name&after=${offset}`
        }
        const res = await axios.get(url)
        res.data.results.forEach((prod) => prods.push(prod))
        if (res.data.paging && res.data.paging.next && res.data.paging.next.after) {
            // console.log(res.data.paging.next.after);
            return getHubspotProducts(prods, res.data.paging.next.after)
        } else {
            // console.log(prods);
            return prods
        }
    } catch (e) {
        console.log("ERROR: COULD NOT GET PRODUCTS FROM HS");
    }
}

const createProduct = async (product) => {
    try {
        if (product.product) {
            const productBody = {
                properties: {
                    name: product.name,
                    price: product.value
                }
            }
            const newProduct = await axios.post(`https://api.hubapi.com/crm/v3/objects/products?hapikey=${process.env.HAPI_KEY}`, productBody, { accept: 'application/json', 'content-type': 'application/json' })
            console.log("CREATED PROD", newProduct.data.id);
            return newProduct.data.id
        } else {
            return undefined
        }
    } catch (e) {
        console.log("ERROR: COULD NOT CREATE PRODUCT", product);
    }
}

const getLineItems = async (items, offset) => {
    try {
        let url = `https://api.hubapi.com/crm/v3/objects/line_items?hapikey=${process.env.HAPI_KEY}&limit=100&archived=false&properties=name&properties=hs_product_id`
        if (offset) {
            url = `${url}&after=${offset}`
        }
        const res = await axios.get(url)
        res.data.results.forEach((item) => items.push(item))
        if (res.data.paging && res.data.paging.next && res.data.paging.next.after) {
            console.log(res.data.paging.next.after);
            return getLineItems(items, res.data.paging.next.after)
        } else {
            return items
        }
    } catch (e) {
        console.log("ERROR, COULD NOT GET LINE ITEMS");
    }
}

const createLineItem = async (name, prodId) => {
    // CREATE LINE ITEM FOR THE PRODUCT
    try {
        const reqBody = {
            properties: {
                hs_product_id: prodId,
                name: name,
                quantity: 1
            }
        }
        const lineItem = await axios.post(`https://api.hubapi.com/crm/v3/objects/line_items?hapikey=${process.env.HAPI_KEY}`, reqBody)
        const lineItemId = lineItem.data.id
        return lineItemId
    } catch (e) {
        console.log("ERROR: COULD NOT CREATE LINE ITEM FOR PRODUCT", e);
    }
}

const createAssociation = async (dealId, lineItemId) => {
    // CREATE HUBSPOT ASSOCIATION FROM LINE ITEM TO DEAL
    try {
        const associationRequest = {
            "fromObjectId": lineItemId,
            "toObjectId": dealId,
            "category": "HUBSPOT_DEFINED",
            "definitionId": 20
        }
        await axios.put(`https://api.hubapi.com/crm-associations/v1/associations?hapikey=${process.env.HAPI_KEY}`, associationRequest)
        console.log(`SUCCESFULLY ASSOCIATED DEAL ${dealId} AND LINE ITEM ${lineItemId}`);

    } catch (e) {
        console.log("ERROR: COULD NOT CREATE ASSOCIATION");
    }
}

const deleteAssociation = async (dealId, lineItemId) => {
    //  DELETE HUBSPOT ASSOCIATION FROM LINE ITEM TO DEAL
    try {
        const associationRequest = {
            "fromObjectId": dealId,
            "toObjectId": lineItemId,
            "category": "HUBSPOT_DEFINED",
            "definitionId": 19
        }
        const res = await axios.put(`https://api.hubapi.com/crm-associations/v1/associations/delete?hapikey=${process.env.HAPI_KEY}`, associationRequest)
    } catch (e) {
        console.log("ERROR: COULD NOT DELETE ASSOCIATION");
    }
}

const getAssociation = async (dealId) => {
    try {
        const res = await axios.get(`https://api.hubapi.com/crm-associations/v1/associations/${dealId}/HUBSPOT_DEFINED/19?hapikey=${process.env.HAPI_KEY}`)
        return res.data.results
    } catch (e) {
        console.log("ERROR", e);
    }
}

const updateDeal = async (dealId, body) => {
    try {
        await axios.patch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}?hapikey=${process.env.HAPI_KEY}`, body, { accept: 'application/json', 'content-type': 'application/json' })
        console.log('SUCCESSFULLY UPDATED DEAL LAST PAYMENT DATE', dealId);
    } catch (e) {
        console.log("ERROR:", e);
    }
}


module.exports = { getUserVID, deleteAssociation, handleStatus, getAssociation, createUser, getContactDeals, getDealData, createDeal, getHubspotProducts, createProduct, getLineItems, createLineItem, createAssociation, updateDeal, associateContactToDeal, createUserOptIn, updateContact }
