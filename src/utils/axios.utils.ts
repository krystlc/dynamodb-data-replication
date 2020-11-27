import axios from 'axios'

const { BASE_URL, MLS_GRID_ACCESS_TOKEN } = process.env

export default axios.create({
  baseURL: BASE_URL,
  timeout: 3000,
  headers: {
    'Authorization': `Bearer ${MLS_GRID_ACCESS_TOKEN}`
  }
}) 