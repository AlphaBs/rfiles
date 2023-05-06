import { ErrorResponse } from "./ErrorResponse"

export class NotFoundResponse extends ErrorResponse {
    constructor(message?: string) {
        if (typeof message === 'undefined')
            super(undefined, 404)
        else
            super(message, 404)
    }
}