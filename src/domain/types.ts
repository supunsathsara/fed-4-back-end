export type Role = "admin" | "staff";

export type UserStatus = "PENDING" | "APPROVED" | "ACTIVE" | "REJECTED" | "SUSPENDED";

export type UserPublicMetadata = {
    role?: Role;
}