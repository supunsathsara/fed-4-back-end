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

    // Debug: Log session claims to see structure
    console.log("[Auth Debug] Session Claims:", JSON.stringify(auth.sessionClaims, null, 2));

    // Try multiple possible locations for role
    const publicMetadata = auth.sessionClaims?.metadata as UserPublicMetadata | undefined;
    const publicMetadataAlt = (auth.sessionClaims as any)?.public_metadata as UserPublicMetadata | undefined;
    
    const role = publicMetadata?.role || publicMetadataAlt?.role;

    console.log("[Auth Debug] Role found:", role);

    if (role !== "admin") {
        throw new ForbiddenError("Forbidden");
    }
    next();
};