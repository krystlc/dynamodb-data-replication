import AWS from 'aws-sdk'
import { MLSDataValueInterface } from '../types/MLSData'

const { TABLE_NAME, TABLE_REGION, TABLE_UNIQUE_KEY_FIELD } = process.env

AWS.config.update({ region: TABLE_REGION })
const ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' })

function formatDataForDynamo(rawData: MLSDataValueInterface) {
  return AWS.DynamoDB.Converter.input(rawData)
}

function insertData(DynamoData: MLSDataValueInterface[]): Promise<any> {
  return new Promise((resolve, reject) => {
    let params: any = []
    let promises: Promise<any>[] = [];
    DynamoData.forEach(async (row, index) => {
      params.push({
        PutRequest: {
          Item: formatDataForDynamo({
            // [(TABLE_UNIQUE_KEY_FIELD as string)]: row['@odata.id'].toString(),  // use your own key value or remove it if api result have the key attribute already.
            ...row,
          }).M
        }
      })
      if (params.length == 25 || index === DynamoData.length - 1) {
        promises.push(new Promise((res, rej) => {
          const processItemsCallback = function (err: any, data: any) {
            if (err) {
              console.error('Error updating db \n', err)
              rej(err)
            } else {
              var params = {};
              if (data.UnprocessedItems.length > 0) {
                (params as any).RequestItems = data.UnprocessedItems;
                ddb.batchWriteItem((params as any), processItemsCallback);
              } else {
                res(true);
              }
            }
          };
          ddb.batchWriteItem({ RequestItems: { [(TABLE_NAME as any)]: params } }, processItemsCallback);
        }));

        params = [];
      }
    })
    Promise.all(promises)
      .then(result => {
        resolve("Done")
      })
      .catch(err => {
        reject(err);
      })
  });
}

export default {
  insertData,
}