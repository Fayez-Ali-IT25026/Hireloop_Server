import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import 'dotenv/config'
import cors from 'cors'
// CHANGE: import Stripe here.
// WHY: this file called stripe.checkout.sessions.retrieve() but never created a
// Stripe client, so /payments/checkout-verify crashed with a 500 every time.
import Stripe from 'stripe'


const app = express();
const PORT = 8000;


app.use(cors());
app.use(express.json());



const client = new MongoClient(process.env.MONGODB_URI)
 

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}





const connectedClient = await connectToMongoDB()
const db = connectedClient.db('hireloop');
const users = db.collection('user');
const jobs = db.collection("jobs");
const applications = db.collection("applications");
const payments = db.collection("payments");

// CHANGE: create the Stripe client once, next to the database collections.
// WHY: it needs STRIPE_SECRET_KEY from .env (same key your Next app uses).
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);




app.get("/", (req, res) => {
  res.send("Server running fine");
});



app.get('/users', async (req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})
















// app.get('/jobs', async (req, res) => {
//     const cursor = jobs.find();
//     const result = await cursor.toArray();
//     res.send(result);
// })
app.get('/jobs', async (req, res) => {

    const query = {};
    // console.log('query', req.query);
    if (req.query) {
        if (req.query.jobType) {
            query.jobType = req.query.jobType;
        }
        if (req.query.isRemote) {
            query.isRemote = req.query.isRemote === 'true';
        }
        if (req.query.category) {
            query.category = req.query.category;
        }
         if (req.query.recruiterId) {
            query.recruiterId = req.query.recruiterId;
        }
        if (req.query.search) {
            query.$or = [
                { title: { $regex: req.query.search, $options: 'i' } },
                { company: { $regex: req.query.search, $options: 'i' } },
                { responsibilities: { $regex: req.query.search, $options: 'i' } },
                { requirements: { $regex: req.query.search, $options: 'i' } }
            ];
        }
    }

    const cursor = jobs.find(query);
    const result = await cursor.toArray();
    res.send(result);
})










// CHANGE: removed this duplicate GET /jobs/:id route.
// WHY: Express uses the first matching route, so this one (no 404 handling)
// shadowed the real one below and returned null for missing jobs.






app.post('/applications', async (req, res) => {
    const now = new Date().toISOString();

    // Fill in the lifecycle fields the client may leave out so every
    // document in `applications` ends up with the same shape.
    const application = {
        status: "applied",
        archived: false,
        appliedAt: now,
        updatedAt: now,
        ...req.body,
    };

    const result = await applications.insertOne(application);
    res.send(result);
})

app.get('/applications', async (req, res) => {

    const query = {};

    if (req.query.applicantId) {
        query.userId = req.query.applicantId;
    }

    if (req.query.jobId) {
        query.jobId = req.query.jobId;
    }

    // Newest applications first.
    const cursor = applications.find(query).sort({ appliedAt: -1 });
    const result = await cursor.toArray();
    res.send(result);
})















app.post('/payments/checkout-verify', async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.send({ success: false, message: 'Session ID is required' });
    }

    // CHANGE: wrapped the whole route in try/catch.
    // WHY: a bad session id or a Stripe error used to crash the request with an
    // empty 500. Now the client gets a readable message.
    try {
        const {
            status,
            payment_status,
            customer_email,
            metadata,
            payment_intent,
        } = await stripe.checkout.sessions.retrieve(sessionId);

        // 1. is used new session 
        // 2. check is the session id for the currently logged in user
        // 3. insert sessionId into the payment Collection
        // 4. update user information as premium user

        if (status !== 'complete' || payment_status !== 'paid') {
            return res.send({ success: false, message: 'Payment verification failed' });
        }

        // CHANGE: stop early when the session has no userId in its metadata.
        // WHY: new ObjectId(undefined) threw, so the request 500'd after Stripe
        // had already taken the money.
        if (!metadata?.userId) {
            return res.status(400).send({ success: false, message: 'Missing userId in session metadata' });
        }

        const sessionQuery = { sessionId };
        const existingPayment = await payments.findOne(sessionQuery);
        if (existingPayment) {
            return res.send({ success: false, message: 'Payment already verified' });
        }

        const payment = {
            sessionId,
            status,
            payment_status,
            customer_email,
            userId: metadata.userId,
            payment_date: new Date(),
            payment_intent,
        }

        const result = await payments.insertOne(payment);

        // update the user table
        const query = { _id: new ObjectId(metadata.userId) };

        const updatedDoc = {
            $set: {
                premium: true,
            }
        }
        const updateResult = await users.updateOne(
            query,
            updatedDoc
        );

        // CHANGE: report a missing user instead of a silent success.
        // WHY: updateOne matched nothing when the id was unknown, but the route
        // still answered success: true.
        if (updateResult.matchedCount === 0) {
            return res.status(404).send({ success: false, message: 'User not found' });
        }

        res.send({ success: true, result, updateResult });
    } catch (error) {
        console.error('Payment verification failed:', error.message);
        res.status(500).send({ success: false, message: 'Payment verification failed' });
    }
})




















app.get('/applications/count', async (req, res) => {
    const query = {};
    if (req.query.applicantId) {
        query.userId = req.query.applicantId;
    }
    const result = await applications.countDocuments(query);
    res.send({ count: result });
})








app.post('/jobs', async (req, res) => {
    const job = req.body;
    const result = await jobs.insertOne(job);
    res.send(result);
})

app.get('/jobs/:id', async (req, res) => {
    const job = await jobs.findOne({ _id: new ObjectId(req.params.id) });
    if (!job) {
        return res.status(404).send({ message: "Job not found" });
    }
    res.send(job);
})

app.patch('/jobs/:id', async (req, res) => {
    const { _id, ...updates } = req.body;
    const result = await jobs.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updates }
    );
    if (!result.matchedCount) {
        return res.status(404).send({ message: "Job not found" });
    }
    res.send(result);
})

app.delete('/jobs/:id', async (req, res) => {
    const result = await jobs.deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) {
        return res.status(404).send({ message: "Job not found" });
    }
    res.send(result);
})


app.listen(PORT, () => {
  console.log(`server is running on PORT ${PORT}`);
});
