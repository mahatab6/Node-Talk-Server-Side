require('dotenv').config();
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");


const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());



app.get('/', (req, res) => {
  res.send('Pet Management Backend is Running');
});

app.listen(port, () => {
  console.log(`Pet Management app listening on port ${port}`)
})



