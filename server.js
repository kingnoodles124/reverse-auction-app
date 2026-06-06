process.env.GOOGLE_APPLICATION_CREDENTIALS =
    './dialogflow-key.json';

const dialogflow =
    require('@google-cloud/dialogflow');

const uuid =
    require('uuid');

console.log("HOST:", process.env.DB_HOST);
console.log("USER:", process.env.DB_USER);
console.log("DB:", process.env.DB_NAME);
console.log("PORT:", process.env.DB_PORT);

const mysql = require('mysql2');

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

db.connect(err => {
    if (err) {
        console.log(err);
    } else {
        console.log('Connected to MySQL');
    }
});

const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server is running');
});

app.post('/register', (req, res) => {

    const {
        username,
        password,
        role,
        category,
        email
    } = req.body;

    const verificationCode =
        Math.floor(
            100000 +
            Math.random() * 900000
        ).toString();

    const sql = `
      INSERT INTO users
      (
        username,
        password,
        role,
        category,
        email,
        verified,
        verification_code
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql, [
            username,
            password,
            role,
            category,
            email,
            false,
            verificationCode
        ],
        (err, result) => {

            if (err) {
                console.log(err);

                return res
                    .status(500)
                    .send(
                        "Error registering user"
                    );
            }

            res.json({
                message: "User registered successfully",
                code: verificationCode,
            });
        }
    );
});

app.post('/verify-account', (req, res) => {

    const { email, code } = req.body;

    const sql = `
        UPDATE users
        SET verified = true
        WHERE email = ?
        AND verification_code = ?
    `;

    db.query(
        sql, [email, code],
        (err, result) => {

            if (err) {
                console.log(err);
                return res
                    .status(500)
                    .send('Database error');
            }

            if (result.affectedRows === 0) {
                return res
                    .status(400)
                    .send('Invalid code');
            }

            res.send(
                'Account verified'
            );
        }
    );
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;

    const sql = "SELECT * FROM users WHERE username = ? AND password = ?";

    db.query(sql, [username, password], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send("Login error");
        }

        if (result.length > 0) {
            if (!result[0].verified) {
                return res.status(403).json({
                    message: 'Please verify your account first'
                });
            }
            res.json({
                message: "Login successful",
                user: result[0]
            });
        } else {
            res.status(401).send("Invalid username or password");
        }
    });
});

app.post('/create-request', (req, res) => {
    const { user_id, title, description, category, budget, deadline } = req.body;

    const sql = `
        INSERT INTO requests (user_id, title, description, category, budget, deadline)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [user_id, title, description, category, budget, deadline], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send("Error creating request");
        }

        res.send("Request created successfully");
    });
});

app.get('/requests', (req, res) => {
    const sql = `
    SELECT
      requests.*,
      COUNT(bids.id) AS bid_count
    FROM requests
    LEFT JOIN bids
      ON requests.id = bids.request_id
    GROUP BY requests.id
  `;

    db.query(sql, async(err, result) => {
        if (err) {
            console.log(err);

            return res
                .status(500)
                .send('Database error');
        }

        const updatedRequests =
            result.map((request) => {
                const createdDate =
                    new Date(
                        request.created_at
                    );

                const currentDate =
                    new Date();

                const differenceInDays =
                    Math.floor(
                        (currentDate -
                            createdDate) /
                        (1000 * 60 * 60 * 24)
                    );

                // Expire if:
                // older than 7 days
                // AND no bids
                if (
                    differenceInDays >= 7 &&
                    request.bid_count == 0
                ) {
                    request.status =
                        'expired';
                }

                return request;
            });

        res.json(updatedRequests);
    });
});

app.post('/place-bid', (req, res) => {
    const { request_id, user_id, price, message } = req.body;

    const checkSql = "SELECT status FROM requests WHERE id = ?";

    db.query(checkSql, [request_id], (err, result) => {
        if (err) {
            console.log(err);
            return res.status(500).send("Error checking request");
        }

        if (result.length === 0) {
            return res.status(404).send("Request not found");
        }

        if (result[0].status === 'closed') {
            return res.status(400).send("This request is already closed");
        }

        const insertSql = `
            INSERT INTO bids (request_id, user_id, price, message)
            VALUES (?, ?, ?, ?)
        `;

        db.query(insertSql, [request_id, user_id, price, message], (err, insertResult) => {
            if (err) {
                console.log(err);
                return res.status(500).send("Error placing bid");
            }

            res.send("Bid placed successfully");
        });
    });
});

app.get('/bids/:request_id', (req, res) => {
    const { request_id } = req.params;

    const sql =
        'SELECT * FROM bids WHERE request_id = ?';

    db.query(sql, [request_id], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send('Database error');
        } else {
            res.json(result);
        }
    });
});

app.post('/accept-bid', (req, res) => {
    const { request_id, bid_id } = req.body;

    const requestSql = `
      UPDATE requests
      SET status = 'closed',
          selected_bid_id = ?
      WHERE id = ?
  `;

    db.query(
        requestSql, [bid_id, request_id],
        (err) => {
            if (err) {
                console.log(err);
                return res
                    .status(500)
                    .send("Error accepting bid");
            }

            const acceptBidSql = `
              UPDATE bids
              SET status = 'accepted'
              WHERE id = ?
          `;

            db.query(
                acceptBidSql, [bid_id],
                (err) => {
                    if (err) {
                        console.log(err);
                        return res
                            .status(500)
                            .send("Error updating winning bid");
                    }

                    const rejectOtherBidsSql = `
                      UPDATE bids
                      SET status = 'rejected'
                      WHERE request_id = ?
                      AND id != ?
                  `;

                    db.query(
                        rejectOtherBidsSql, [request_id, bid_id],
                        (err) => {
                            if (err) {
                                console.log(err);
                                return res
                                    .status(500)
                                    .send("Error rejecting bids");
                            }

                            res.send(
                                "Bid accepted successfully"
                            );
                        }
                    );
                }
            );
        }
    );
});

app.get('/accepted-bids/:user_id', (req, res) => {
    const { user_id } = req.params;

    const sql = `
    SELECT
      bids.id,
      bids.price,
      bids.message,
      requests.title,
      requests.description
    FROM bids
    JOIN requests
      ON bids.request_id = requests.id
    WHERE bids.user_id = ?
      AND requests.status = 'accepted'
  `;

    db.query(sql, [user_id], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send('Database error');
        } else {
            res.json(result);
        }
    });
});

app.get('/my-requests/:user_id', (req, res) => {
    const { user_id } = req.params;

    const sql =
        'SELECT * FROM requests WHERE user_id = ?';

    db.query(sql, [user_id], (err, result) => {
        if (err) {
            console.log(err);
            res.status(500).send('Database error');
        } else {
            res.json(result);
        }
    });
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});

app.post('/chatbot', async(req, res) => {
    try {
        const { message } = req.body;

        const sessionId =
            uuid.v4();

        const sessionClient =
            new dialogflow.SessionsClient();

        const sessionPath =
            sessionClient.projectAgentSessionPath(
                'reverseauctionbot-kvsn',
                sessionId
            );

        const request = {
            session: sessionPath,

            queryInput: {
                text: {
                    text: message,

                    languageCode: 'en',
                },
            },
        };

        const responses =
            await sessionClient.detectIntent(
                request
            );

        const result =
            responses[0].queryResult;

        res.json({
            reply: result.fulfillmentText,
        });
    } catch (error) {
        console.log(error);

        res.status(500).json({
            reply: 'AI assistant unavailable',
        });
    }
});

app.get('/my-bids/:userId', (req, res) => {
    const { userId } = req.params;

    const sql = `
    SELECT
      bids.id,
      bids.price,
      bids.message,
      bids.created_at,
      bids.status AS bid_status,
      requests.title,
      requests.status AS request_status
    FROM bids
    JOIN requests
    ON bids.request_id = requests.id
    WHERE bids.user_id = ?
    ORDER BY bids.created_at DESC
  `;

    db.query(
        sql, [userId],
        (err, result) => {
            if (err) {
                console.log(err);

                return res
                    .status(500)
                    .send('Database error');
            }

            res.json(result);
        }
    );
});