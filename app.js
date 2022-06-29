if (process.env.NODE_ENV !== "production") {
    require('dotenv').config();
}

const express = require('express');
const mongoose = require('mongoose');
const ejsMate = require('ejs-mate');
const path = require('path');
const passport = require('passport');
const LocalStrategy = require('passport-local');
const User = require('./models/user');
const flash = require('connect-flash');
const session = require('express-session');
const MongoDBStore = require("connect-mongo")(session);

const userRoutes = require('./routes/users');

const { Octokit, App } = require("octokit");

const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017/assessment';
//Used for storing data of the authenticated user

mongoose.connect(dbUrl, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
    useFindAndModify: false
});

const db = mongoose.connection;
db.on("error", console.error.bind(console, "connection error:"));
db.once("open", () => {
    console.log("Database connected");
});

const app = express();

app.engine('ejs', ejsMate)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'))

const secret = process.env.SECRET || 'thisshouldbeabettersecret!';

const store = new MongoDBStore({
    url: dbUrl,
    secret,
    touchAfter: 24 * 60 * 60
});

const sessionConfig = {
    store,
    name: 'session',
    secret,
    resave: false,
    saveUninitialized: true,
    cookie: {
        httpOnly: true,
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7,
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')))
app.use(session(sessionConfig))
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use((req, res, next) => {
    console.log(req.session)
    res.locals.currentUser = req.user;
    res.locals.success = req.flash('success');
    res.locals.error = req.flash('error');
    next();
})

app.use('/', userRoutes);

app.get('/', (req, res) => {
    res.render('home')
})

isLoggedIn = (req, res, next) => {
    if (!req.isAuthenticated()) {
        req.session.returnTo = req.originalUrl
        req.flash('error', 'You must be signed in first!');
        return res.redirect('/login');
    }
    next();
}

const octokit = new Octokit()

app.get('/options', isLoggedIn, (req, res) => {
    res.render('repos/options')
})

//Creating a repository
app.get('/create', (req, res) => {
    res.render('repos/create')
})

app.post('/create', isLoggedIn, async (req, res) => {
    const { username, repo_name, token, description, visibility } = req.body

    const options = {
        auth: token
    }

    let visible;

    if(visibility==="public")
    {
        visible = false;
    }
    else{
        visible = true;
    }

    const octoKit = new Octokit(options)

    await octoKit.request('POST /user/repos', {
        "name": repo_name,
        "description": description,
        "homepage": "https://github.com",
        "private": visible
    })

    req.flash('success', 'Successfully created new repo!');
    res.redirect('/options')
})

//Listing all repos

app.get('/repo_list', isLoggedIn, (req, res) => {
    res.render('repos/repo_list')
})

app.post('/show', isLoggedIn, async (req, res) => {
    let username = req.body.username

    if (username == '') {
        username = req.user.username
    }

    const response = await octokit.request('GET /users/{user_name}/repos', {
        user_name: username
    }
    )

    const repos = response.data
    res.render('repos/show_list', { repos })

})

//Listing contributors and stargazers list

app.get('/contri_list', isLoggedIn, (req, res) => {
    res.render('repos/contri_list')
})

app.post('/contributors', isLoggedIn, async (req, res) => {
    let { username, repo_name } = req.body

    if (username !== '') {
        const response1 = await octokit.request('GET /repos/{username}/{reponame}/contributors', {
            username: username,
            reponame: repo_name
        })
    
        const response2 = await octokit.request('GET /repos/{username}/{reponame}/stargazers', {
            username: username,
            reponame: repo_name
        })
    
        const contributors = response1.data;
        const stargazers = response2.data;
        res.render('repos/contributors', { contributors, stargazers })
    }
    else{
        username = req.user.username

        const response = await octokit.request('GET /users/{user_name}/repos', {
            user_name: username
        }
        )
    
        const repos = response.data
        req.flash('error', 'Username missing');
        res.render('repos/show_list', { repos })
    }
})

//Listing all topics related to a repo provided by the user and if not provided repos of the authenticated user will be displayed
app.get('/list_topic', (req,res)=>{
    res.render('repos/list_topic_form')
})

app.post('/list_topic', async(req,res)=>{
    let { username, repo_name} = req.body

    if(username !== '')
    {
        let response = await octokit.request('GET /repos/{owner}/{repo}/topics', {
            owner: username,
            repo: repo_name
        })
    
        const topics = response.data.names
        res.render('repos/list_topic', {topics, repo_name})
    }
    else{
        username = req.user.username

        const response = await octokit.request('GET /users/{user_name}/repos', {
            user_name: username
        }
        )
    
        const repos = response.data
        req.flash('error', 'Username missing');
        res.render('repos/show_list', { repos })
    }
})

//Updating topics
//If username not provided, repos of the authenticated user will be displayed

app.get('/update_topic', (req, res) => {
    res.render('repos/update_topic')
})

app.post('/update_topic', async (req, res) => {
    let { username, repo_name, token, topic } = req.body
   
    if(username !== '')
    {
        const options = {
            auth: token
        }
    
        const octoKit = new Octokit(options)
    
        let response = await octokit.request('GET /repos/{owner}/{repo}/topics', {
            owner: username,
            repo: repo_name
        })
    
        response.data.name = response.data.names.push(topic)
    
        await octoKit.request('PUT /repos/{username}/{repo_name}/topics', {
            username: username,
            repo_name: repo_name,
            "names": response.data.names
        })
    
        req.flash('success', 'Successfully updated!!');
        res.redirect('/options')
    }
    else{
        username = req.user.username

        const response = await octokit.request('GET /users/{user_name}/repos', {
            user_name: username
        }
        )
    
        const repos = response.data
       
        res.render('repos/show_list', { repos })
    }
   
})

//Deleting a topic
//If username not provided, repos of the authenticated user will be displayed

app.get('/delete_topic', (req, res) => {
    res.render('repos/delete_topic')
})

app.post('/delete_topic', async (req, res) => {
    let { username, repo_name, token, topic } = req.body
    
    if(username !== '')
    {
        const options = {
            auth: token
        }
    
        const octoKit = new Octokit(options)
    
        let response = await octokit.request('GET /repos/{owner}/{repo}/topics', {
            owner: username,
            repo: repo_name
        })
    
        if (response.data.names.length > 0) {
            const array = response.data.names
    
            for (let i = array.length - 1; i >= 0; i--) {
                if (array[i] === topic) {
                    array.splice(i, 1);
                }
            }
            
            await octoKit.request('PUT /repos/{username}/{repo_name}/topics', {
                username: username,
                repo_name: repo_name,
                "names": array
            })
        }
    
        req.flash('success', 'Successfully Deleted');
        res.redirect('/options')
    }
    else{
        username = req.user.username

        const response = await octokit.request('GET /users/{user_name}/repos', {
            user_name: username
        }
        )
    
        const repos = response.data
       
        res.render('repos/show_list', { repos })
    }
    
})

//list all the repos of a given user with > 5 stars and > 5 forks
//If username not provided, repos of the authenticated user will be displayed

app.get('/count', (req,res)=>{
    res.render('repos/star_list_form')
})

app.post('/count', async(req,res)=>{
    let username = req.body.username

    if (username == '') {
        username = req.user.username
    }

    const response = await octokit.request('GET /users/{user_name}/repos', {
        user_name: username
    }
    )

    const repos = response.data
    res.render('repos/star_list', { repos })
})

port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log( `Serving on Port ${port} `)
})        