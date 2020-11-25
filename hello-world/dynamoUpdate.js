'use strict';

const AWS = require('aws-sdk');
const axios = require('axios');


const TABLE_NAME = 'geo_test_8';   //Your table name here
const TABLE_REGION = 'ap-south-1';   //Your table name here
const TABLE_UNIQUE_KEY_FIELD = 'id';
const sc = "ALL";

AWS.config.update({ region: TABLE_REGION });
var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });


module.exports.handler = (event, context) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    var filter = "";
    var URL = 'https://jsoneditoronline.herokuapp.com/v1/docs/7dcaa7963ee8408d9f2be6e472319681/data'; //Your API url here
    // URL = "https://api.mlsgrid.com/PropertyResi";
    const scope = event['scope'] || sc;

    if (scope === 'ALL')
        filter = "MlgCanView eq true";
    else if (scope === "MODIFICATION")
        filter = `ModificationTimestamp gt ${yesterday.toISOString()}`;
    URL = `${URL}?filter=${encodeURI(filter)}`;
    URL = event['url'] || URL;

    const METHOD = "GET";     //Your API method here
    var continiue = true;
    return new Promise(async (resolve, reject) => {
        while (continiue) {
            console.log("in loop");
            const requestOptions = {
                url: URL,
                method: METHOD,
                // headers:''
            };
            console.log(requestOptions);

            await axios(requestOptions)
                .then(async result => {
                    const dynamoUpdateData = result.data.value;
                    const nextUrl = result.data['@odata.nextLink'];
                    console.log("nextUrl", nextUrl);
                    if (nextUrl && nextUrl.length > 0) {
                        URL = nextUrl;
                        continiue = true;
                    }
                    else {
                        continiue = false;
                    }
                    var res;
                    if (scope === 'ALL')
                        res = insertData(dynamoUpdateData);
                    else if (scope === "MODIFICATION")
                        res = updateData(dynamoUpdateData);

                    /*
                    await can be used if you want to do each set of operaition sequentially
                    By any chance, if the execution time is near to timeout, then lambda can trigger another version of
                    self automatically with url an scope as a parameter. this can be achived if await is used.
                    */
                    // await res.then(resp => {                   
                    res.then(resp => {
                        console.log(resp);
                        if (context.getRemainingTimeInMillis() < 10000 && nextUrl && nextUrl.length > 0) {
                            continiue = false;
                            invokeAnotherVersion(nextUrl, scope, context.invokedFunctionArn)
                        }
                    })
                })
                .catch(error => {
                    console.log(error);
                    reject("Error in fetching extarnal data.");
                    continiue = false;
                });
        }
        console.log("completed");

    });
};

function formateDataForDynamo(rawData) {
    return AWS.DynamoDB.Converter.input(rawData);
}

function updateData(data) {
    console.log("updating...");
    return new Promise((resolve, reject) => {
        var promises = [];
        data.forEach(async row => {
            var params = {
                TableName: TABLE_NAME,
                Item: formateDataForDynamo({
                    [TABLE_UNIQUE_KEY_FIELD]: row['ListingId'].toString(),  // use your own key value or remove it if api result have the key attribute already.
                    ...row
                }).M
            };
            promises.push(new Promise((res, rej) => {
                ddb.putItem(params, function (err, data) {
                    if (err) {
                        console.log("Error updating data", err);
                        rej(false);
                    } else {
                        console.log("Data updated", data);
                        res(true);
                    }
                });
            }));
        });
        Promise.all(promises)
            .then(result => {
                console.log(result);
                if (result.includes(false))
                    console.log("handle error in updating data");
                resolve("Done")
            })
            .catch(err => {
                console.log("handle error in updating data");
                reject(err);
            })
    });
}

function insertData(DynamoData) {
    console.log("inserting...");

    return new Promise((resolve, reject) => {
        var params = []
        var promises = [];
        DynamoData.forEach(async (row, index) => {
            params.push({
                PutRequest: {
                    Item: formateDataForDynamo({
                        [TABLE_UNIQUE_KEY_FIELD]: row['@odata.id'].toString(),  // use your own key value or remove it if api result have the key attribute already.
                        ...row,
                    }).M
                }
            })
            if (params.length == 25 || index === DynamoData.length - 1) {
                console.log(params.length);
                promises.push(new Promise((res, rej) => {
                    var processItemsCallback = function (err, data) {
                        if (err) {
                            console.log("Error", err);
                            rej("Error in updating data in dynamo db.");
                        } else {
                            var params = {};
                            if (data.UnprocessedItems.length > 0) {
                                params.RequestItems = data.UnprocessedItems;
                                ddb.batchWriteItem(params, processItemsCallback);
                            } else {
                                res(true);
                            }
                        }
                    };
                    ddb.batchWriteItem({ RequestItems: { [TABLE_NAME]: params } }, processItemsCallback);
                }));

                params = [];
            }
        })
        Promise.all(promises)
            .then(result => {
                console.log(result);
                resolve("Done")
            })
            .catch(err => {
                reject(err);
            })
    });
}

function invokeAnotherVersion(url, scope, arn) {
    var lambda = new AWS.Lambda();
    var params = {
        FunctionName: arn,
        InvocationType: "Event",
        Payload: JSON.stringify({ url, scope }),
        Qualifier: "1"
    };
    lambda.invoke(params, function (err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else console.log(data);           // successful response
    });
}
