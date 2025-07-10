require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require('mongodb');


const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());


// Admin SDK

const admin = require("firebase-admin");

const decodedKey =Buffer.from(process.env.FB_SERVICRKEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decodedKey)

const {getAuth} = require('firebase-admin/auth');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// verifyToken

const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'unauthorized access' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = decoded;
    next();
  } 
  
  catch (error) {
    return res.status(401).send({ message: "unauthorized" });
  }
};


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

    // user new post added
    app.post('/add-user-post', async(req, res) => {
      const newPost = req.body;
      const result = await postCollection.insertOne(newPost);
      res.send(result)
    })

    // specific user post
    app.get('/specific-post',verifyJWT, async(req, res) =>{
      const email = req.user.email;
      const result = await postCollection.find({AuthorEmail: email}).toArray();
      res.send(result);
    })

    // home page post
    app.get('/public-post', async(req, res) =>{
      const result = await postCollection.find().toArray();
      res.send(result);
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



