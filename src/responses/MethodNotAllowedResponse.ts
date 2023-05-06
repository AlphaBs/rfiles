import { ErrorResponse } from "./ErrorResponse";

export class MethodNotAllowedResponse extends ErrorResponse {
    constructor(message?: string, allowed?: Array<string>) {
        let allowHeader: Array<string> = []
        if (typeof allowed !== 'undefined')
            allowHeader = allowed

        super(message, 405, {
            headers: {
                Allow: allowHeader.join(','),
            }
        });
    }
}