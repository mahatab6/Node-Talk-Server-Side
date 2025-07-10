require('dotenv').config();
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require('mongodb');


const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());



const uri = process.env.MongoDB_URL;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("NodeTalkDataBase");
    const postCollection = database.collection("postColl")

    app.post('/add-user-post', async(req, res) => {
      const newPost = req.body;
      const result = await postCollection.insertOne(newPost);
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);




app.get('/', (req, res) => {
  res.send('NodeTalk Backend is Running');
});

app.listen(port, () => {
  console.log(`NodeTalk app listening on port ${port}`)
})



