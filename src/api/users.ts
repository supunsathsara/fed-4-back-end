import express from "express";
import { authenticationMiddleware } from "./middlewares/authentication-middleware";
import { authorizationMiddleware } from "./middlewares/authorization-middleware";
import { 
  getAllUsers, 
  getCurrentUser,
  getUnassignedUsers, 
  getUsersWithAssignmentStatus,
  getPendingUsers,
  approveUser,
  rejectUser,
  suspendUser,
  reactivateUser,
} from "../application/users";

const usersRouter = express.Router();

usersRouter.route("/").get(getAllUsers);
usersRouter.route("/me").get(authenticationMiddleware, getCurrentUser);
usersRouter.route("/unassigned").get(authenticationMiddleware, authorizationMiddleware, getUnassignedUsers);
usersRouter.route("/with-status").get(authenticationMiddleware, authorizationMiddleware, getUsersWithAssignmentStatus);
usersRouter.route("/pending").get(authenticationMiddleware, authorizationMiddleware, getPendingUsers);
usersRouter.route("/:id/approve").patch(authenticationMiddleware, authorizationMiddleware, approveUser);
usersRouter.route("/:id/reject").patch(authenticationMiddleware, authorizationMiddleware, rejectUser);
usersRouter.route("/:id/suspend").patch(authenticationMiddleware, authorizationMiddleware, suspendUser);
usersRouter.route("/:id/reactivate").patch(authenticationMiddleware, authorizationMiddleware, reactivateUser);

export default usersRouter;