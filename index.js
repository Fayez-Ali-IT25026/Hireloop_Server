import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import 'dotenv/config'
import cors from 'cors'


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










app.get(`/jobs/:id`, async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await jobs.findOne(query);
    res.send(result);
})






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

    if (status === 'complete' && payment_status === 'paid') {

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
        res.send({ success: true, result, updateResult });
        return
    }
    res.send({ success: false, message: 'Payment verification failed' });
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
