import AWS from 'aws-sdk'
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda"
import { Scope, County } from './types/Enums'
import { MLSDataResponseInterface, MLSDataValueInterface } from './types/MLSData'
import { AxiosRequestConfig, AxiosResponse } from "axios"

import $axios from './utils/axios.utils'
import ddb from './utils/ddb.utils'

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
  const scope = Number(event.queryStringParameters?.scope) ?? Scope.Upsert
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
      return buildResult(200, process)
    }
    return buildResult(204, response)
  } catch (err) {
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
    const response = await ddb.insertData(filteredProperties)
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