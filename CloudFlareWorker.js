export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // 1. Configuration
        // Even if you accidentally leave a trailing slash here, the code below fixes it.
        let UPSTREAM_URL = 'https://nonresilient-rylan-nondebilitating.ngrok-free.dev';

        // Remove trailing slash if present to prevent double slashes (//)
        UPSTREAM_URL = UPSTREAM_URL.replace(/\/$/, '');

        // 2. Define CORS headers for the RESPONSE (to the App/Browser)
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS, PUT, PATCH, DELETE',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, ngrok-skip-browser-warning',
        };

        // 3. Handle OPTIONS (Preflight)
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // 4. Construct the new URL (Cleanly)
        const newUrl = UPSTREAM_URL + url.pathname + url.search;

        // 5. Clean up Headers for the UPSTREAM request (to Ngrok/Localhost)
        const newHeaders = new Headers(request.headers);

        // Standard Fixes:
        newHeaders.set('ngrok-skip-browser-warning', 'true');
        newHeaders.delete('Host');

        // --- NEW FIX FOR "BLOCKED CORS ORIGIN" ---
        // We strip these so your local server doesn't see "dash.cloudflare.com" 
        // or "localhost:3000" and block it.
        newHeaders.delete('Origin');
        newHeaders.delete('Referer');
        // ----------------------------------------

        const newRequest = new Request(newUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.body,
            redirect: 'follow',
        });

        try {
            const response = await fetch(newRequest);

            // 6. Re-create response with CORS headers
            const newResponse = new Response(response.body, response);
            Object.keys(corsHeaders).forEach((key) => {
                newResponse.headers.set(key, corsHeaders[key]);
            });

            return newResponse;

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    },
};