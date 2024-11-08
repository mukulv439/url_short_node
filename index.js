const express = require("express");
const shortid = require("shortid");
const mysql = require("mysql");
const bcrypt = require("bcrypt");
const session = require("express-session");
const app = express();

app.set("view engine", "ejs");
app.use(express.static(__dirname + "/public"));
app.use(express.urlencoded({ extended: false }));
app.use(express.json()); // Parse JSON data

// Session setup
app.use(session({
    secret:'cd83c80b4d9e85b45a8e678282209f8086a0c928c6c0e87b8d9d3b85a0e79a',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }  
}));


const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "url_shortener"
});

db.connect(err => {
    if (err) {
        console.log("Error connecting to DB:", err);
        return;
    }
    console.log("Connected to DB");
});

// Home route
app.get("/", (req, res) => {
    res.render("home.ejs");
});
app.get("/register", (req, res) => {
    res.render("register.ejs");
});
app.get("/login", (req, res) => {
    res.render("login.ejs");
});

app.get("/userstats", (req, res) => {
    const userId = req.session.userId;

    // Check if the user is logged in
    if (!userId) {
        return res.status(401).send("Please log in first.");  // Changed to 401 (Unauthorized)
    }

    // Query the database for the URLs associated with the userId
    db.query('SELECT * FROM `url` WHERE `userId` = ?', [userId], (err, results) => {
        if (err) {
            console.error("Database error:", err);  // Log the error for debugging purposes
            return res.status(500).send("Internal server error.");
        }

        // If no URLs are found, show a message indicating no URLs were created by the user
        if (results.length === 0) {
            return res.status(404).send("You haven't created any URLs yet.");
        }

        // Render the result page with the user's URLs
        return res.render("userstats.ejs", { urls: results });
    });
});


// Short URL creation
app.post("/shorturl", (req, res) => {
    const fullUrl = req.body.fullUrl;
    const customShort = req.body.customCode || null; // Custom short code (optional)
    const expirationDate = req.body.expireDate ? new Date(req.body.expireDate) : null;
    const userId = req.session.userId;

    // Check if the full URL is provided
    if (!fullUrl) {
        return res.status(400).send("Full URL is required.");
    }

    // Check if expiration date is provided and is in the future
    if (expirationDate && expirationDate <= new Date()) {
        return res.status(400).send("Expiration date must be a future date.");
    }

    // If a custom short URL is provided, we need to check if it already exists
    if (customShort) {
        db.query('SELECT * FROM `url` WHERE `shortUrl` = ?', [customShort], (error, results) => {
            if (error) {
                console.error("Database error:", error);
                return res.status(500).send("Database error.");
            }

            if (results.length > 0) {
                // If the custom short URL is already taken, return an error
                return res.status(400).send("Custom short URL is already taken.");
            }

            // Insert new URL with the custom short code
            const url = {
                fullUrl: fullUrl,
                shortUrl: customShort,
                counts: 1,
                userId: userId,
                expiresAt: expirationDate
            };

            db.query('INSERT INTO `url` SET ?', url, (err, result) => {
                if (err) {
                    console.error("Error inserting URL:", err);
                    return res.status(500).send("Error creating short URL.");
                }

                return res.render("result.ejs", { shortUrl: customShort, times: 1 });
            });
        });
    } else {
        // If no custom short URL is provided, generate a random one
        db.query('SELECT * FROM `url` WHERE `fullUrl` = ?', [fullUrl], (error, results) => {
            if (error) {
                console.error("Database error:", error);
                return res.status(500).send("Database error.");
            }

            if (results.length === 0) {
                const short = shortid.generate(); // Generate a random short URL

                const url = {
                    fullUrl: fullUrl,
                    shortUrl: short,
                    counts: 1,
                    userId: userId,
                    expiresAt: expirationDate
                };

                // Insert the new URL with the generated short URL into the database
                db.query('INSERT INTO `url` SET ?', url, (err, result) => {
                    if (err) {
                        console.error("Error inserting URL:", err);
                        return res.status(500).send("Error creating short URL.");
                    }

                    return res.render("result.ejs", { shortUrl: short, times: 1 });
                });
            } else {
                // If the URL already exists, increment the visit count and return the existing short URL
                const _short = results[0].shortUrl;
                const _counts = results[0].counts;
                const _expiresAt = results[0].expiresAt;

                // Check if the URL has expired
                if (_expiresAt && new Date(_expiresAt) < new Date()) {
                    return res.status(410).send("This URL has expired.");
                }

                // Update the visit count
                db.query('UPDATE `url` SET `counts` = ? WHERE `shortUrl` = ?', [_counts + 1, _short], (err, result) => {
                    if (err) {
                        console.error("Error updating counts:", err);
                        return res.status(500).send("Error updating URL.");
                    }

                    return res.render("result.ejs", { shortUrl: _short, times: _counts + 1 });
                });
            }
        });
    }
});

// Redirect to the full URL based on the short URL
app.get("/:shortUrl", (req, res) => {
    const shortUrl = req.params.shortUrl;

    db.query('SELECT * FROM `url` WHERE `shortUrl` = ?', [shortUrl], (error, results) => {
        if (error) {
            console.error("Database error:", error);
            return res.status(500).send("Internal Server Error.");
        }

        if (results.length === 0) {
            return res.render("error.ejs", { message: "Short URL not found." });
        }

        const url = results[0];
        const _short = url.shortUrl;
        const _counts = url.counts;
        const _expiresAt = url.expiresAt;

        if (_expiresAt) {
            const expirationDate = new Date(_expiresAt);
            const currentDate = new Date();

            if (expirationDate < currentDate) {
                return res.status(410).send("This URL has expired.");
            }
        }

        db.query('UPDATE `url` SET `counts` = ? WHERE `shortUrl` = ?', [_counts + 1, _short], (err, result) => {
            if (err) {
                console.error("Error updating counts:", err);
                return res.status(500).send("Error updating visit count.");
            }

            return res.redirect(url.fullUrl);
        });
    });
});

// User registration route

app.post("/register", (req, res) => {
    const { username, password } = req.body;

    // Validate inputs
    if (!username || !password) {
        return res.status(400).send("Please provide both username and password.");
    }

    // Validate password length
    if (password.length < 6) {
        return res.status(400).send("Password must be at least 6 characters long.");
    }

    // Check if username already exists
    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err) {
            console.error("Database error:", err);
            return res.status(500).send("Internal server error.");
        }

        if (results.length > 0) {
            return res.status(400).send("Username is already taken.");
        }

        // Hash the password before storing it
        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) {
                console.error("Error hashing password:", err);
                return res.status(500).send("Error hashing password.");
            }

            // Insert new user into the database
            const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
            db.query(query, [username, hashedPassword], (err, result) => {
                if (err) {
                    console.error("Error registering user:", err);
                    return res.status(500).send("Error registering user.");
                }

                // Optionally, return the user ID or a success message
                res.redirect('/');
            });
        });
    });
});
// User login route
app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).send("Please provide username and password.");
    }

    db.query('SELECT * FROM users WHERE username = ?', [username], (err, results) => {
        if (err || results.length === 0) {
            return res.status(400).send("User not found.");
        }

        const user = results[0];
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err || !isMatch) {
                return res.status(400).send("Incorrect password.");
            }

            req.session.userId = user.id;
            res.redirect('/');
        });
    });
});

// Delete short URL route
app.post("/deleteurl", (req, res) => {
    const shortUrl = req.body.shortUrl;
    const userId = req.session.userId;

    if (!userId) {
        return res.status(400).send("Please log in first.");
    }

    if (!shortUrl) {
        return res.status(400).send("Short URL is required.");
    }

    db.query('DELETE FROM `url` WHERE `shortUrl` = ? AND `userId` = ?', [shortUrl, userId], (err, result) => {
        if (err) {
            return res.status(500).send("Internal server error.");
        }

        if (result.affectedRows === 0) {
            return res.status(404).send("URL not found or you don't have permission to delete this URL.");
        }

        return res.redirect('/userstats');
    });
});

// User stats route


app.listen(3000, () => {
    console.log("Server running on port 3000");
});
