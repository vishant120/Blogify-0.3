const { Schema, model } = require("mongoose");

const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["FOLLOW_REQUEST", "LIKE", "COMMENT", "REPLY"],
      required: true,
    },
    blogId: { type: Schema.Types.ObjectId, ref: "Blog", default: null },
    status: {
      type: String,
      enum: ["UNREAD", "READ", "PENDING", "ACCEPTED", "REJECTED"],
    },
    message: { type: String, required: true },
    content: { type: String },
  },
  { timestamps: true }
);

module.exports = model("Notification", notificationSchema);
