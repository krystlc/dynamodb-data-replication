import AWS, { Endpoint } from 'aws-sdk'
import { MLSDataValueInterface } from '../types/MLSData'

const { TABLE_NAME, TABLE_UNIQUE_KEY_FIELD } = process.env
const awsRegion = process.env.AWS_REGION || 'us-east-1'

AWS.config.update({
  region: awsRegion,
})
// set the end point
const ddb = new AWS.DynamoDB({
  apiVersion: '2012-08-10'
})

if(process.env.AWS_SAM_LOCAL) {
  ddb.endpoint = new Endpoint('http://dynamodb:8000')
  console.log('aws sam is local', ddb.config.endpoint)
}

function formatDataForDynamo(rawData: MLSDataValueInterface) {
  return AWS.DynamoDB.Converter.marshall(rawData)
}

function insertData(DynamoData: MLSDataValueInterface[]): Promise<any> {
  console.log('start!')
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
              console.error('Error updating db \n', err)
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
          ddb.batchWriteItem({ RequestItems: { [(TABLE_NAME as any)]: params } }, processItemsCallback)
        }))

        params = []
      }
    })
    Promise.all(promises)
      .then(result => {
        resolve('Done')
      })
      .catch(err => {
        reject(err)
      })
  })
}

export default {
  insertData,
}