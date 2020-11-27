import AWS, { Endpoint } from 'aws-sdk'

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

export default ddb