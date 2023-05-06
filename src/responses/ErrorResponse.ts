export class ErrorResponse extends Response {
    constructor(error?: string|undefined, status?: number|undefined, options?: ResponseInit|undefined) {
        let body: string|null
        if (typeof error === 'undefined') {
            body = null
        }
        else {
            body = JSON.stringify({
                error: error
            });
        }

        if (typeof options === 'undefined')
            options = {}
        options.status = status
        super(body, options)
    }
}