require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const stripe = require('stripe')(process.env.Secret_key);

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
    const userCollection = database.collection("userColl")
    const votesCollection = database.collection("votesColl")
    const commentCollection = database.collection("commentColl")
    const reportCollection = database.collection("reportColl")
    const paymentHistory = database.collection("payment")
    const tagsCollection = database.collection("tagsColl")

    // user new post added
    app.post('/add-user-post', async(req, res) => {
      const newPost = req.body;
      const result = await postCollection.insertOne(newPost);
      res.send(result)
    })

    // specific user post
    app.get('/specific-post',verifyJWT, async(req, res) =>{
      const email = req.user.email;
      const result = await postCollection.find({AuthorEmail: email}).sort({ createdAt: -1 }).toArray();
      res.send(result);
    })

    // specific post delete on user
    app.delete('/user-post-remove/:id', async(req, res) =>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const result = await postCollection.deleteOne(query);
      res.send(result)
    })

    // home page post
    app.get('/public-post', async(req, res) =>{
      const search = req.query.search ||'';
      const sort = req.query.sort||'';
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit);
      const skip = (page -1)*limit;

      const query = {};
      if(search){
        query["tags.value"] = { $regex: search, $options: 'i'};
      }
    
      // most popular
      if(sort === "popular"){
        const pipeline = [
          {$match: query},
          {
            $addFields:{
              voteDifference: { $subtract: ['$upVote', '$downVote'] }
            }
          },
          { $sort: { voteDifference: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
          $project: {
            AuthorEmail: 0
          }
          }
        ];

        const posts = await postCollection.aggregate(pipeline).toArray();
        const total = await postCollection.countDocuments(query);
        return res.send({ post: posts, total });
      }

      // most down
      if (sort === "downVote") {
        const pipeline = [
          { $match: query },
          {
            $addFields: {
              voteDifference: {
                $subtract: [
                  { $ifNull: ["$downVote", 0] },
                  { $ifNull: ["$upVote", 0] }
                ]
              }
            }
          },
          { $sort: { voteDifference: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $project: { AuthorEmail: 0 } }
        ];

        const posts = await postCollection.aggregate(pipeline).toArray();
        const total = await postCollection.countDocuments(query);
        return res.send({ post: posts, total });
      }

   
      const total = await postCollection.countDocuments(query);
      const result = await postCollection.find(query, {projection:{AuthorEmail:0}}).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray();
      res.send({post: result, total});
    })

    // userComment stor and count
    app.post('/comments', async(req, res) => {
      const comment = req.body;
      const postId = req.body.postId;
      const result = await commentCollection.insertOne(comment);

      const filter = { _id: new ObjectId(postId) };
      const updateDoc = { $inc: { commentCount: 1 } };

      const updateResult = await postCollection.updateOne(filter, updateDoc);

      res.send(result)
    })

    // user-comment-show
   app.get('/specific-post-comment/:id', async (req, res) => {
    const id = req.params.id;
    const query = { postId: id };
    const comments = await commentCollection.find(query).toArray(); 
    const commentIds = comments.map(comment => comment._id.toString());

    const reports = await reportCollection.find({commentId: { $in: commentIds }}).toArray();

    const reportedSet = new Set(reports.map(r => r.commentId));

    const results = comments.map(comment => ({
      ...comment,
      reported: reportedSet.has(comment._id.toString())
    }));

    res.send(results);
});


    // user-Feedback-Report
    app.post('/user-feedback-report', async(req, res) =>{
      const reportInfo = req.body;
      const result = await reportCollection.insertOne(reportInfo);
      res.send(result)
    })

    // votes counts
    app.post('/vote', async (req, res) =>{
      const {postId, voterEmail, voteType} =req.body
      const objectId = ObjectId.createFromHexString(postId);
      const voteField = voteType === 'up'? 'upVote' : 'downVote';
      const oppsideVoteField = voteType === 'up'? 'downVote' : 'upVote';
      
      const existingVoter = await votesCollection.findOne({postId, voterEmail});

      if(!existingVoter){
        await votesCollection.insertOne({ postId, voterEmail, voteType });
        await postCollection.updateOne(
          { _id: objectId },
          { $inc: { [voteField]: 1 } }
          );
          
          return res.send({ message: `Voted ${voteType}` });
      }

      if(existingVoter.voteType === voteType){
        await votesCollection.deleteOne({postId, voterEmail});
        await postCollection.updateOne(
          {_id: objectId},
          {$inc: {[voteField]: -1}}
        );
    
        return res.send({ message: `${voteType} vote remove` });
      }

      await votesCollection.updateOne(
        {postId, voterEmail},
        {$set: voteType}
      );
      await postCollection.updateOne(
        {_id: objectId},
        {
          $inc: {
            [voteField]:1,
            [oppsideVoteField]: -1
          }
        }
      )
      return res.send({ message: `Vote changed to ${voteType}` });

    })

    // admin comment show
    app.get('/reported-comments-show',verifyJWT, async (req, res) =>{

      const reports = await reportCollection.find({}).toArray();
      const commentIds = reports.map(r => new ObjectId(r.commentId));
      const reportedComments = await commentCollection.find({ _id: { $in: commentIds } }).toArray();
      res.send({ comments: reportedComments, reports: reports});
    
    })

    // report comment delete

    app.delete('/comment/:id',verifyJWT, async (req, res) =>{
      const id = req.params.id;
      await commentCollection.deleteOne({ _id: new ObjectId(id) });
      const reportResult = await reportCollection.deleteMany({ commentId: id });
      res.send(reportResult);
    } )
 

    // user-post-summary
    app.get('/user-summary/:email', async (req, res)=>{
      const email = req.params.email;
      const posts = await postCollection.aggregate([
        {$match: {AuthorEmail: email}},
        {
          $project: {
            _id:1,
            upVote:1
          }
        }
      ]).toArray();

      const postIds = posts.map(post => post._id.toString())
      const totalPost = posts.length;

      const totalUpVote = posts.reduce((sum, post)=> sum + (post.upVote || 0), 0);
      const totalComment = await commentCollection.countDocuments({
      postId: { $in: postIds }
      });

      const recentPost = await postCollection.find({ AuthorEmail: email }).sort({createdAt: -1}).limit(5).toArray();
      
      res.send({
        totalPost,
        totalComment,
        totalUpVote,
        recentPost
      })
      
    })

    // user-post-count
    app.get('/user-post-count/:email', async(req, res) =>{
      const email = req.params.email;
      const result = await postCollection.countDocuments({ AuthorEmail: email})
      res.send({result})
    })


    // post details page
    app.get('/post-details/:id', async(req, res) => {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await postCollection.findOne(query, {projection:{AuthorEmail:0}});
      res.send(result)
    })

    // user role info
    app.post('/users', async(req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUsers = await userCollection.findOne(query);
      if(existingUsers){
        return res.send({ message: 'User already exists' })
      }
      const result = await userCollection.insertOne(user);
      res.send(result)
    })


    // user role founding
    app.get('/user-role', verifyJWT, async (req, res) => {
      const email = req.user.email;
      const user = await userCollection.findOne({ email });
      res.send({ role: user?.role, creationTime: user?.creationTime });
    });

    // payment intent

    app.post('/create-payment-intent', async (req, res) => {
      const serviceCosut = req.body.serviceCosut;
  
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1000, // amount in cents
        currency: 'usd',
        automatic_payment_methods: {enabled: true},
      });

      res.send({
        clientSecret: paymentIntent.client_secret
      });
    } catch (error) {
      res.status(500).send({ error: error.message });
    }
    });

    // payment history
    app.post("/payments", async (req, res) =>{

      const { paymentIntent, userEmail } = req.body;

      const paymentDoc = {

        email: userEmail,
        transactionId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        createdAt: new Date(paymentIntent.created * 1000),
        paymentIntent: paymentIntent,

      };
      const paymentResult = await paymentHistory.insertOne(paymentDoc);
      const userUpdateResult = await userCollection.updateOne(
        { email: userEmail },
        { $set: { role: "paidmember" } });
      
      res.send({message: "Payment recorded and user upgraded."})
      console.log(paymentDoc)
    })

    // manage user stats
    app.get('/manage-user-stats', async (req, res) => {
      const userSearch = req.query.search;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit);
      const skip = (page -1)*limit;

      const query = {};
      if(userSearch){
        query.email = { $regex: userSearch, $options:"i"}
      }
      
      const totalUser = await userCollection.countDocuments();
      const adminCount = await userCollection.countDocuments({role: 'admin'});
      const paidMemberCount = await userCollection.countDocuments({role: 'paidmember'});
      const onlyUserCount = await userCollection.countDocuments({role: 'user'});
      const userStats = await userCollection.find(query).skip(skip).limit(limit).toArray();

      res.send({
        totalUser,
        adminCount,
        paidMemberCount,
        onlyUserCount, 
        userStats
      })
      
    })

    // admin profile info for user count
    app.get('/total-user-info', async(req, res) =>{
      const postCount = await postCollection.countDocuments();
      const commentCount = await commentCollection.countDocuments();
      const userCount = await userCollection.countDocuments();
      const tags = await tagsCollection.find().sort({ createdAt: -1 }).limit(20).toArray();

      res.send({
        postCount,
        commentCount,
        userCount,
        tags
      })
    })

    // admin tags add api
    app.post('/added-tags', async (req, res) => {
      const newTag = req.body.tags;

      const query = { tags: newTag };
      const existingTags = await tagsCollection.findOne(query);

      if (existingTags) {
        return res.send({ message: "Tags already adding" });
      }

      const result = await tagsCollection.insertOne({ tags: newTag, createdAt: new Date() });
      res.send(result);
    });


    // user role change
    app.patch('/user-stats-change/:id',verifyJWT, async(req, res) =>{
      const userId = req.params.id;
      const {role} = req.body;

      const result = await userCollection.updateOne(
        {_id: new ObjectId(userId)},
        { $set: {role: role}}
      )
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



