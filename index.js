const express = require('express')
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config()
const { handleProd, handlePrice } = require('./utils/products')
const { getUserVID, deleteAssociation, getAssociation, createUser, getContactDeals, getDealData, createDeal, getHubspotProducts, createProduct, handleStatus, createLineItem, createAssociation, updateDeal, associateContactToDeal, createUserOptIn, updateContact } = require('./utils/hubspot')
const app = express()
app.use(bodyParser.json())

const PORT = process.env.PORT || 3000

const stripe = require('stripe')(process.env.STRIPE_PROD_SK);  // FOR PROD
// const stripe = require('stripe')(process.env.STRIPE_TEST_SK); // FOR DEV

app.get("/", (req, res) => {
    res.send(JSON.stringify({ "Hello": "World" }))
});

app.post('/cancel_subscription', async (req, res) => {
    const payload = req.body.data.object
    const customerId = payload.customer
    const productPriceId = payload.plan.id
    const priceObj = handlePrice(productPriceId)
    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email
    const name = customer.name || customer.metadata.name
    let date = new Date()
    date = date.setUTCHours(0, 0, 0, 0)
    const userId = await getUserVID(email)
    if (userId) {
        try {
            const deals = await getContactDeals(userId)
            let dealsWithData = await Promise.all(deals.map(async (deal) => {
                return await getDealData(deal)
            }))
            dealsWithData = dealsWithData.filter((deal) => {
                return deal.properties.pipeline && deal.properties.pipeline === '6808662'
            })
            const match = dealsWithData.find((ele) => {
                return ele.properties && ele.properties.dealname && ele.properties.dealname === `${name} - ${priceObj.name}`
            })
            if (match) {
                const body = {
                    properties: {
                        cancelled_date: date,
                        status: "Cancelled"
                    }
                }
                await updateDeal(match.id, body)
            } else {
                console.log("NO ASSOCIATED DEAL FOUND");
            }
        } catch (e) {
            console.log("ERROR: COULD NOT UPDATE DEAL");
        }
    }
    res.status(200).send()
})

app.post('/subscription_updated', async (req, res) => {
    try {
        const payload = req.body.data.object
        const prevStatus = req.body.data.previous_attributes.status
        const customerId = payload.customer
        const productPriceId = payload.items.data[0].price.id
        const status = payload.status
        const priceObj = handlePrice(productPriceId)
        const product = payload.items.data[0].price.product || payload.plan.product
        const prodInfo = handleProd(product)
        const newStatus = handleStatus(status)
        const customer = await stripe.customers.retrieve(customerId);
        const email = customer.email
        const name = customer.name || customer.metadata.name

        const userId = await getUserVID(email)
        if (userId) {
            const deals = await getContactDeals(userId)
            if (deals && deals.length > 0) {
                let dealsWithData = await Promise.all(deals.map(async (deal) => {
                    return await getDealData(deal)
                }))
                dealsWithData = dealsWithData.filter((deal) => {
                    return deal.properties.pipeline && deal.properties.pipeline === '6808662'
                })
                let match = null;
                if (prodInfo.prod === "Authorify") {
                    match = dealsWithData.find((ele) => {
                        return ele.properties.authorify_product && ele.properties.authorify_product !== null
                    })
                } else if (prodInfo.prod === "RMA") {
                    match = dealsWithData.find((ele) => {
                        return ele.properties.referral_marketing_product && ele.properties.referral_marketing_product !== null
                    })
                } else if (prodInfo.prod === "DFY") {
                    match = dealsWithData.find((ele) => {
                        return ele.properties && ele.properties.dfy_product_name && ele.properties.dfy_product_name !== null
                    })
                }
                if (match) {
                    const body = {
                        properties: {
                            'dealname': `${name} - ${priceObj.name}`,
                            amount: priceObj.value,
                            "status": newStatus

                        }
                    }
                    // if (prevStatus !== status) {
                    // const newStatus = handleStatus(status)
                    // body.properties['status'] = newStatus
                    // }
                    body.properties[priceObj.productProperty] = priceObj.product
                    body.properties[priceObj.priceProperty] = priceObj.value
                    updateDeal(match.id, body)

                    const associations = await getAssociation(match.id)
                    await Promise.all(associations.map(async (association) => {
                        await deleteAssociation(match.id, association)
                    }))
                    const hubspotProducts = await getHubspotProducts([])
                    const productMatch = hubspotProducts.find((item) => {
                        return item.properties.name && item.properties.name === priceObj.name
                    })
                    if (productMatch) {
                        console.log("PRODUCT MATCH", productMatch);
                        const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                        await createAssociation(match.id, lineItemId)
                    } else {
                        const productId = await createProduct(priceObj)
                        console.log('CREATED PROD', productId);
                        const lineItemId = await createLineItem(priceObj.name, productId)
                        await createAssociation(match.id, lineItemId)
                    }
                }
            }
        }
        res.status(200).send()
    } catch (e) {
        console.log("ERROR: COULD NOT UPDATE DEAL");
        res.status(400).send()
    }
})

app.post('/create_subscription', async (req, res) => {
    const payload = req.body
    const product = payload.data.object.items.data[0].price.product
    const customerId = payload.data.object.customer
    const productPriceId = payload.data.object.items.data[0].price.id
    const priceObj = handlePrice(productPriceId)
    const status = payload.data.object.status || "Active"
    const prodInfo = handleProd(product)
    const customer = await stripe.customers.retrieve(customerId);
    const email = customer.email
    let name = customer.metadata.name || customer.name || customer.shipping.name
    let newStatus = handleStatus(status)

    try {
        let userId = await getUserVID(email)
        if (!userId) {
            userId = await createUser(email, name)
        }
        const deals = await getContactDeals(userId)
        if (deals && deals.length > 0) {
            let dealsWithData = await Promise.all(deals.map(async (deal) => {
                return await getDealData(deal)
            }))
            dealsWithData = dealsWithData.filter((deal) => {
                return deal.properties.pipeline && deal.properties.pipeline === '6808662'
            })
            if (prodInfo.prod === "Authorify") {
                const match = dealsWithData.find((ele) => {
                    return ele.properties.authorify_product && ele.properties.authorify_product !== null
                })
                if (match) {
                    if (status === "trialing") {
                        return
                    } else {
                        const body = {
                            properties: {
                                "dealname": `${name} - ${priceObj.name}`,
                                "status": newStatus
                            }
                        }
                        body.properties[priceObj.productProperty] = priceObj.product
                        body.properties[priceObj.priceProperty] = priceObj.value
                        body.properties.amount = priceObj.value
                        await updateDeal(match.id, body)
                        const associations = await getAssociation(match.id)
                        await Promise.all(associations.map(async (association) => {
                            await deleteAssociation(match.id, association)
                        }))
                        const hubspotProducts = await getHubspotProducts([])
                        const productMatch = hubspotProducts.find((item) => {
                            return item.properties.name && item.properties.name === priceObj.name
                        })
                        if (productMatch) {
                            const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                            await createAssociation(match.id, lineItemId)
                        } else {
                            const productId = await createProduct(priceObj)
                            const lineItemId = await createLineItem(priceObj.name, productId)
                            await createAssociation(match.id, lineItemId)
                        }
                    }
                    return
                } else {
                    const dealId = await createDeal(priceObj, name, status)
                    await associateContactToDeal(dealId, userId)
                    const hubspotProducts = await getHubspotProducts([])
                    const productMatch = hubspotProducts.find((item) => {
                        return item.properties.name && item.properties.name === priceObj.name
                    })
                    if (productMatch) {
                        const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                        await createAssociation(dealId, lineItemId)
                    } else {
                        const productId = await createProduct(priceObj)
                        const lineItemId = await createLineItem(priceObj.name, productId)
                        await createAssociation(dealId, lineItemId)
                    }
                }
            } else if (prodInfo.prod === "RMA") {
                const match = dealsWithData.find((ele) => {
                    return ele.properties.referral_marketing_product && ele.properties.referral_marketing_product !== null
                })
                if (match) {
                    if (status === "trialing") {
                        return
                    } else {
                        const body = {
                            properties: {
                                "dealname": `${name} - ${priceObj.name}`,
                                "status": newStatus
                            }
                        }
                        body.properties[priceObj.productProperty] = priceObj.product
                        body.properties[priceObj.priceProperty] = priceObj.value
                        await updateDeal(match.id, body)
                        const associations = await getAssociation(match.id)
                        await Promise.all(associations.map(async (association) => {
                            await deleteAssociation(match.id, association)
                        }))
                        const hubspotProducts = await getHubspotProducts([])
                        const productMatch = hubspotProducts.find((item) => {
                            return item.properties.name && item.properties.name === priceObj.name
                        })
                        if (productMatch) {
                            const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                            await createAssociation(match.id, lineItemId)
                        } else {
                            const productId = await createProduct(priceObj)
                            const lineItemId = await createLineItem(priceObj.name, productId)
                            await createAssociation(match.id, lineItemId)
                        }
                    }
                    return
                } else {
                    const dealId = await createDeal(priceObj, name, status)
                    await associateContactToDeal(dealId, userId)
                    const hubspotProducts = await getHubspotProducts([])
                    const productMatch = hubspotProducts.find((item) => {
                        return item.properties.name && item.properties.name === priceObj.name
                    })
                    if (productMatch) {
                        const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                        await createAssociation(dealId, lineItemId)
                    } else {
                        const productId = await createProduct(priceObj)
                        const lineItemId = await createLineItem(priceObj.name, productId)
                        await createAssociation(dealId, lineItemId)
                    }
                }
            } else if (prodInfo.prod === "DFY") {
                const match = dealsWithData.find((ele) => {
                    return ele.properties && ele.properties.dfy_product_name && ele.properties.dfy_product_name !== null
                })
                if (match) {
                    if (status === "trialing") {
                        return
                    } else {
                        const body = {
                            properties: {
                                "dealname": `${name} - ${priceObj.name}`,
                                "status": newStatus
                            }
                        }
                        body.properties[priceObj.productProperty] = priceObj.product
                        body.properties[priceObj.priceProperty] = priceObj.value
                        await updateDeal(match.id, body)
                        const associations = await getAssociation(match.id)
                        await Promise.all(associations.map(async (association) => {
                            await deleteAssociation(match.id, association)
                        }))
                        const hubspotProducts = await getHubspotProducts([])
                        const productMatch = hubspotProducts.find((item) => {
                            return item.properties.name && item.properties.name === priceObj.name
                        })
                        if (productMatch) {
                            const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                            await createAssociation(match.id, lineItemId)
                        } else {
                            const productId = await createProduct(priceObj)
                            const lineItemId = await createLineItem(priceObj.name, productId)
                            await createAssociation(match.id, lineItemId)
                        }
                    }
                    return
                } else {
                    const dealId = await createDeal(priceObj, name, status)
                    await associateContactToDeal(dealId, userId)
                    const hubspotProducts = await getHubspotProducts([])
                    const productMatch = hubspotProducts.find((item) => {
                        return item.properties.name && item.properties.name === priceObj.name
                    })
                    if (productMatch) {
                        const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                        await createAssociation(dealId, lineItemId)
                    } else {
                        const productId = await createProduct(priceObj)
                        const lineItemId = await createLineItem(priceObj.name, productId)
                        await createAssociation(dealId, lineItemId)
                    }
                }
            }
        } else {
            const dealId = await createDeal(priceObj, name, status)
            await associateContactToDeal(dealId, userId)
            const hubspotProducts = await getHubspotProducts([])
            const productMatch = hubspotProducts.find((item) => {
                return item.properties && item.properties.name && item.properties.name === priceObj.name
            })
            if (productMatch) {
                const lineItemId = await createLineItem(priceObj.name, productMatch.id)
                await createAssociation(dealId, lineItemId)
            } else {
                const productId = await createProduct(priceObj)
                const lineItemId = await createLineItem(priceObj.name, productId)
                await createAssociation(dealId, lineItemId)
            }
        }
        res.status(200).send()
    } catch (e) {
        console.log("ERROR", e);
        res.status(400).send(e)
    }
})

app.post('/successful_payment', async (req, res) => {
    const payload = req.body.data.object
    const customerId = payload.customer
    const customer = await stripe.customers.retrieve(customerId);
    const invoiceId = payload.invoice
    console.log("INVOICE ID", invoiceId);
    const email = customer.email
    const name = customer.name || customer.metadata.name
    const userId = await getUserVID(email)
    let date = new Date()
    date = date.setUTCHours(0, 0, 0, 0)
    if (userId && invoiceId) {
        const invoiceData = await stripe.invoices.retrieve(invoiceId);
        const productPriceId = invoiceData.lines.data[0].price.id
        const priceObj = handlePrice(productPriceId)
        try {
            let deals = await getContactDeals(userId)
            let dealsWithData = await Promise.all(deals.map(async (deal) => {
                return await getDealData(deal)
            }))
            dealsWithData = dealsWithData.filter((deal) => {
                return deal.properties.pipeline && deal.properties.pipeline === '6808662'
            })
            let match = dealsWithData.find((ele) => {
                return ele.properties.dealname && (ele.properties.dealname === `${name} - ${priceObj.product}`) || (ele.properties.dealname === `${name} - ${priceObj.name}`)
            })
            if (match) {
                const body = {
                    properties: {
                        "status": "Active",
                        "last_payment_date": date
                    }
                }
                await updateDeal(match.id, body)
            } else {
                setTimeout(async () => {
                    deals = await getContactDeals(userId)
                    dealsWithData = await Promise.all(deals.map(async (deal) => {
                        return await getDealData(deal)
                    }))
                    dealsWithData = dealsWithData.filter((deal) => {
                        return deal.properties.pipeline && deal.properties.pipeline === '6808662'
                    })
                    match = dealsWithData.find((ele) => {
                        return ele.properties.dealname && (ele.properties.dealname === `${name} - ${priceObj.product}`) || (ele.properties.dealname === `${name} - ${priceObj.name}`)
                    })
                    if (match) {
                        const body = {
                            properties: {
                                "status": "Active",
                                "last_payment_date": date
                            }
                        }
                        await updateDeal(match.id, body)
                    }
                }, 5000)
            }
        } catch (e) {
            console.log("ERROR: COULD NOT UPDATE DEAL");
        }
    }
    res.status(200).send()
})

app.post('/failed_payment', async (req, res) => {
    const payload = req.body.data.object
    try {
        const customerId = payload.customer
        const customer = await stripe.customers.retrieve(customerId);
        const invoiceId = payload.invoice
        console.log("INVOICE ID", invoiceId);
        const email = customer.email
        const name = customer.name || customer.metadata.name
        const userId = await getUserVID(email)
        let date = new Date()
        date = date.setUTCHours(0, 0, 0, 0)

        if (userId && invoiceId) {
            const invoiceData = await stripe.invoices.retrieve(invoiceId);
            const productPriceId = invoiceData.lines.data[0].price.id
            const priceObj = handlePrice(productPriceId)
            let deals = await getContactDeals(userId)
            let dealsWithData = await Promise.all(deals.map(async (deal) => {
                return await getDealData(deal)
            }))
            dealsWithData = dealsWithData.filter((deal) => {
                return deal.properties.pipeline && deal.properties.pipeline === '6808662'
            })
            let match = dealsWithData.find((ele) => {
                return ele.properties.dealname && (ele.properties.dealname === `${name} - ${priceObj.product}`) || (ele.properties.dealname === `${name} - ${priceObj.name}`)
            })
            if (match) {
                const body = {
                    properties: {
                        "hold_payment_date": date
                    }
                }
                await updateDeal(match.id, body)

            } else {
                setTimeout(async () => {
                    deals = await getContactDeals(userId)
                    dealsWithData = await Promise.all(deals.map(async (deal) => {
                        return await getDealData(deal)
                    }))
                    dealsWithData = dealsWithData.filter((deal) => {
                        return deal.properties.pipeline && deal.properties.pipeline === '6808662'
                    })
                    match = dealsWithData.find((ele) => {
                        return ele.properties.dealname && (ele.properties.dealname === `${name} - ${priceObj.product}`) || (ele.properties.dealname === `${name} - ${priceObj.name}`)
                    })
                    if (match) {
                        const body = {
                            properties: {
                                "hold_payment_date": date
                            }
                        }
                        await updateDeal(match.id, body)

                    }
                }, 5000)
            }
        }
    } catch (e) {
        console.log("ERROR: COULD NOT UPDATE DEAL");
    }
    res.status(200).send()
})

app.post('/expiring_card', async (req, res) => {
    const email = req.body.data.object.owner.email
    if (email) {
        try {
            const userId = await getUserVID(email)
            const deals = await getContactDeals(userId)
            for (const deal of deals) {
                const body = {
                    properties: {
                        "status": "Expired"
                    }
                }
                await updateDeal(deal, body)
            }
        } catch (e) {
            console.log("ERROR: COULD NOT UPDATE DEAL");
        }
    }
    res.status(200).send()
})

app.post('/funnel_webhooks/test', async (req, res) => {
    // for the purpose of creating webhook - test for click funnels verification
    res.status(200).send()
})

app.post('/click_funnels', async (req, res) => {
    const purchase = req.body.purchase
    const firstName = purchase.contact.first_name
    const lastName = purchase.contact.last_name
    const email = purchase.contact.email
    const member_opt_in = purchase.contact.member_opt_in
    if (member_opt_in === "true") {
        try {
            let userId = await getUserVID(email)

            if (!userId) {
                userId = await createUserOptIn(email, firstName, lastName, true)
            } else {
                // update contacts's opt in if they selected it
                updateContact(userId)
            }
        } catch (e) {
            console.log("ERROR", e);
        }
    }
    res.status(200).send()
})


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
})
