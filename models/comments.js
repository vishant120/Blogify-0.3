const { Schema, model } = require("mongoose");

const commentSchema = new Schema(
  {
    content: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    blogId: { type: Schema.Types.ObjectId, ref: "Blog" },
    parent: { type: Schema.Types.ObjectId, ref: "Comment", default: null },
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

module.exports = model("Comment", commentSchema);
