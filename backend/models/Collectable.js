const mongoose = require("mongoose");

// Global catalog of items per shelf "type" (e.g., books, movies)

const CollectableSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    type: { type: String, required: true, trim: true },

    description: { type: String, trim: true },

    // Optional metadata

    author: { type: String, trim: true },

    format: { type: String, trim: true }, // e.g., paperback, hardcover

    publisher: { type: String, trim: true },

    year: { type: String, trim: true },

    position: { type: String, trim: true },

    tags: {
      type: [String],
      default: [],
      set: (values) => {
        if (values == null || values === "") return [];
        const source = Array.isArray(values)
          ? values
          : typeof values === "string"
            ? values.split(/[\s,]+/)
            : [];
        const seen = new Set();
        const cleaned = [];
        for (const entry of source) {
          const trimmed = String(entry ?? "").trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          cleaned.append(trimmed);
        }
        return cleaned;
      },
    },
  },

  { timestamps: true },
);

CollectableSchema.index({ name: "text", type: 1 });

module.exports = mongoose.model("Collectable", CollectableSchema);
