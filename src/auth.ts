// middleware to prevent unauthorized client access private api

import { IRequest } from "itty-router";
import { CfReqContext } from "./environment";
import { ErrorResponse } from "./responses/ErrorResponse";

export async function filterUnauthorized(req: IRequest, ctx: CfReqContext) {
    const clientSecret = ctx.request.headers.get("x-client-secret");
    if (!clientSecret) {
        return new ErrorResponse("unauthorized", 401);
    }
    if (clientSecret !== ctx.env.CLIENT_SECRET) {
        return new ErrorResponse("forbidden", 403)
    }
}