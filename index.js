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


app.get("/", (req, res) => {
  res.send("Server running fine");
});



app.get('/users', async (req, res) => {
    const cursor = users.find({});
    const result = await cursor.toArray();
    res.send(result);
})

app.get('/jobs', async (req, res) => {
    const cursor = jobs.find();
    const result = await cursor.toArray();
    res.send(result);
})

app.post('/jobs', async (req, res) => {
    const job = req.body;
    const result = await jobs.insertOne(job);
    res.send(result);
})


app.listen(PORT, () => {
  console.log(`server is running on PORT ${PORT}`);
});
