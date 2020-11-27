import AWS from 'aws-sdk'
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import { Scope, County } from './types/Enums'
import { MLSDataResponseInterface, MLSDataValueInterface } from './types/MLSData'
import { AxiosRequestConfig, AxiosResponse } from "axios"

import $axios from './utils/axios.utils'
import ddb from './utils/ddb.utils'
import { BatchWriteItemInput } from 'aws-sdk/clients/dynamodb'

const { TABLE_NAME, TABLE_UNIQUE_KEY_FIELD } = process.env

// const COUNTIES = [
//   County.Hillsborough,
//   County.Pasco,
//   County.Pinellas
// ]

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html 
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 * 
 */
export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  const scope: Scope = event.queryStringParameters?.scope
    ? Number(event.queryStringParameters.scope)
    : Scope.Upsert
  console.log('process scope', Scope[scope])
  try {
    const { url, options } = buildUrl(event, scope)
    const response: AxiosResponse<MLSDataResponseInterface> = await $axios.get(url, options)
    if (response?.data) {
      // const value = response.data?.value
      // const nextLink = response.data?.["@odata.nextLink"]
      // const process = await Promise.all([
      //   handleResponseData(value, scope),
      //   invokeAnotherVersion(nextLink, scope, context.invokedFunctionArn)
      // ])
      const process = await Promise.all([
        handleResponseData((response.data as any), scope)
      ])
      console.log(200, process)
      return buildResult(200, process)
    }
    console.log(204, response)
    return buildResult(204, response)
  } catch (err) {
    console.log(400, err)
    return buildResult(400, err)
  }
}

const buildResult = (statusCode: number, body: any): APIGatewayProxyResult => ({
  statusCode,
  body: JSON.stringify(body)
})

const buildUrl = (event: APIGatewayProxyEvent, scope: Scope): { url: string, options?: any } => {
  if (event?.queryStringParameters?.url) {
    return {
      url: event.queryStringParameters.url
    }
  }
  // const yesterday = new Date()
  // yesterday.setDate(yesterday.getDate() - 1)
  // const filter = scope === Scope.Upsert
  //   ? "MlgCanView eq true"
  //   : `ModificationTimestamp gt ${yesterday.toISOString()}`
  // const apiMethod = 'PropertyResi'
  // const options: AxiosRequestConfig = {}
  const apiMethod = 'breweries'
  const options: AxiosRequestConfig = {
    params: {
      per_page: 50
    }
  }
  return {
    url: apiMethod,
    options,
  }
}

const handleResponseData = async (properties: MLSDataValueInterface[], scope: Scope): Promise<any> => {
  if (properties) {
    const action = scope === Scope.Delete ? 'delete' : 'upsert'
    // const filteredProperties = properties.filter(property => COUNTIES.includes(property.CountyOrParish))
    const filteredProperties = properties.filter(property => (property as any).brewery_type === 'micro')
    const response = scope === Scope.Upsert
      ? await insertProperties(filteredProperties)
      : await deleteProperties(filteredProperties)
    return response
  }
  return null
}

const invokeAnotherVersion = async (url: string | undefined, scope: Scope, FunctionName: string): Promise<any> => {
  if (url) {
    const lambda = new AWS.Lambda()
    const params: AWS.Lambda.InvocationRequest = {
      FunctionName,
      InvocationType: "Event",
      Payload: JSON.stringify({ url, scope }),
      Qualifier: "1"
    }
    const response = await lambda.invoke(params, function (err, data) {
      if (err) console.error(err, err.stack) // an error occurred
      else console.log(data)           // successful response
    }).promise()
    return response
  }
  return null
}

function formatDataForDynamo(rawData: MLSDataValueInterface) {
  return AWS.DynamoDB.Converter.marshall(rawData)
}

function insertProperties(DynamoData: MLSDataValueInterface[]): Promise<any> {
  console.log('begin inserting data')
  return new Promise((resolve, reject) => {
    let params: any = []
    let promises: Promise<any>[] = []
    DynamoData.forEach(async (row, index) => {
      const { id, ...property } = row
      params.push({
        PutRequest: {
          Item: formatDataForDynamo({
            // [(TABLE_UNIQUE_KEY_FIELD as string)]: row['@odata.id'].toString(),  // use your own key value or remove it if api result have the key attribute already.
            [(TABLE_UNIQUE_KEY_FIELD as string)]: String(id),  // use your own key value or remove it if api result have the key attribute already.
            ...property,
          })
        }
      })
      if (params.length == 25 || index === DynamoData.length - 1) {
        promises.push(new Promise((res, rej) => {
          const processItemsCallback = function (err: any, data: any) {
            if (err) {
              console.error('error updating db \n', err)
              rej(err)
            } else {
              var params = {}
              if (data.UnprocessedItems.length > 0) {
                (params as any).RequestItems = data.UnprocessedItems
                ddb.batchWriteItem((params as any), processItemsCallback)
              } else {
                res(true)
              }
            }
          }
          console.log('processing batch', params)
          ddb.batchWriteItem({ 
            RequestItems: { 
              [(TABLE_NAME as any)]: params
            } 
          }, processItemsCallback)
        }))

        params = []
      }
    })
    Promise.all(promises)
      .then(result => {
        resolve({
          message: `${result.length} batches insterted`
        })
      })
      .catch(err => {
        reject(err)
      })
  })
}

/**
 * 
 * todo: refactor both these functions into one
 */
function deleteProperties(DynamoData: MLSDataValueInterface[]): Promise<any> {
  console.log('begin deleting data')
  return new Promise((resolve, reject) => {
    let params: any = []
    let promises: Promise<any>[] = []
    DynamoData.forEach(async (row, index) => {
      params.push({
        DeleteRequest: {
          Key: formatDataForDynamo({
            [(TABLE_UNIQUE_KEY_FIELD as string)]: String(row.id),
          } as any),
        }
      })
      if (params.length == 25 || index === DynamoData.length - 1) {
        promises.push(new Promise((res, rej) => {
          const processItemsCallback = function (err: any, data: any) {
            if (err) {
              console.error('error deleting db items \n', err)
              rej(err)
            } else {
              var params = {}
              if (data.UnprocessedItems.length > 0) {
                (params as any).RequestItems = data.UnprocessedItems
                ddb.batchWriteItem((params as BatchWriteItemInput), processItemsCallback)
              } else {
                res(true)
              }
            }
          }
          console.log('processing batch', params)
          ddb.batchWriteItem({ 
            RequestItems: { 
              [(TABLE_NAME as any)]: params
            } 
          }, processItemsCallback)
        }))

        params = []
      }
    })
    Promise.all(promises)
      .then(result => {
        resolve({
          message: `${result.length} batches deleted`
        })
      })
      .catch(err => {
        reject(err)
      })
  })
}