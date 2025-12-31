import { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { User } from "../../infrastructure/entities/User";
import { ForbiddenError, UnauthorizedError } from "../../domain/errors/errors";
import { UserPublicMetadata } from "../../domain/types";

export const authorizationMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const auth = getAuth(req);
    if (!auth.userId) {
        throw new UnauthorizedError("Unauthorized");
    }
    console.log("[Auth Debug] Session Claims:", JSON.stringify(auth.sessionClaims, null, 2));
    // Access public_metadata from customized session token
    const publicMetadata = (auth.sessionClaims as any)?.public_metadata as UserPublicMetadata | undefined;

    if (!publicMetadata || publicMetadata.role !== "admin") {
        throw new ForbiddenError("Forbidden");
    }
    next();
};