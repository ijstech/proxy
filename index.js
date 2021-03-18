const Https = require('https');
const Http = require('http');
const Url = require('url');
const HttpProxy = require('http-proxy');

var Options = {};

function isSSL(url){
    return /^https|wss/.test(url.protocol);
}
function isWeb(url){
    return /^https|http/.test(url.protocol);
}
function isWebSocket(url){
    return /^ws/.test(url.protocol);
}
function resolve(path) {
    if (path && Options.rules){
        for (let i = 0; i < Options.rules.length; i ++){
            let option = Options.rules[i];
            if (option.match && path.match(option.match)){
                return option.host + path;
            }                
        }
    }
}
async function proxy(ctx, url){    
    if (isWeb(url))
        return proxyWeb(ctx, url);
    else if (isWebSocket(url))
        return proxyWebSocket(ctx, url);
}
async function proxyWeb(ctx, url){    
    return new Promise(function(resolve, reject){        
        try{
            let data = [];
            let headers = ctx.request.headers;            
            ctx.req.on("data", chunk => {
                data.push(chunk)
            });
            ctx.req.on("end", async () => {                               
                data = Buffer.concat(data)
                try{                    
                    let reqHeaders = {
                        charset: headers.charset,
                        'content-type': ctx.request.type,
                        'content-length': data.length,
                        origin: url.hostname,
                        referer: headers.referer
                    }
                    if (headers.cookie)
                        reqHeaders.cookies = headers.cookie;                    
                    
                    const request = (isSSL(url)?Https:Http).request({
                        hostname: url.hostname,
                        port: url.port,
                        path: url.path,
                        method: ctx.method,
                        headers: reqHeaders
                    }, response => {        
                        let responseData = [];
                        response.on('data', data => {
                            responseData.push(data);
                        });
                        response.on('error', (err) => {
                            ctx.status = 500;
                            ctx.body = err;
                            reject();
                        });
                        response.on('end', (res) => {                    
                            responseData = Buffer.concat(responseData);                            
                            ctx.set('Content-Length', responseData.length);
                            ctx.set('Content-Type', response.headers['content-type']);
                            ctx.body = responseData;
                            resolve();
                        });
                    });
                    request.write(data);
                    request.end();  
                }
                catch(err){                      
                    reject();
                }               
            });
        }   
        catch(err){            
            reject(err);
        }        
    })
}
var Proxy = {};
function getProxy(url){
    url = Url.parse(url);
    let proxy = Proxy[url.pathname];
    if (proxy)
        return proxy;
    proxy = HttpProxy.createProxyServer({target: `${url.protocol}//${url.host}`, changeOrigin: true}); 
    Proxy[url.pathname] = proxy;
    return proxy;
}
module.exports = {
    _init: function(options, app){        
        Options = options;    
        if (app.http){
            app.http.on('upgrade', function upgrade(request, socket, head) {
                let url = resolve(request.url);                
                if (url){                              
                    getProxy(url).ws(request, socket, head)
                }
            });
        }
        if (app.https){
            app.https.on('upgrade', function upgrade(request, socket, head) {
                let url = resolve(request.url);
                if (url){
                    getProxy(url).ws(request, socket, head)
                }
            });
        }
    },
    _middleware: async function(ctx, next){         
        let url = resolve(ctx.path);                
        if (url){
            try{
                let result = await proxyWeb(ctx, Url.parse(url))
            }
            catch(err){
                ctx.status = 500;
            }            
        }
        else
            await next();
    }
}