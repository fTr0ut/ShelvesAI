const mongoose = require('mongoose');
const app = require('./server');

const PORT = process.env.PORT || 5001;

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
        console.log('MongoDB connected');
         const origDeleteMany = mongoose.Model.deleteMany;
        mongoose.Model.deleteMany = function (...args) {
         console.warn(`⚠️ deleteMany called on ${this.modelName}`, args[0]);
        return origDeleteMany.apply(this, args);
    };

        const origRemove = mongoose.Model.remove;
        mongoose.Model.remove = function (...args) {
         console.warn(`⚠️ remove called on ${this.modelName}`, args[0]);
        return origRemove.apply(this, args);
    };

         const origDrop = mongoose.connection.db.dropDatabase;
        mongoose.connection.db.dropDatabase = function (...args) {
         console.error(`🚨 dropDatabase called! Args:`, args);
        throw new Error("dropDatabase is blocked in this environment");
    };
    // -----------------------       
        app.listen(PORT, () => {
            console.log(`API listening on http://localhost:${PORT}`);
        });
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });


