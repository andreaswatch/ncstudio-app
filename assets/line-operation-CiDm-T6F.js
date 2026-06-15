async function r(e,s){const{start:n,end:t}=s,a=(await e.client.CreateLine({document:{id:e.docId},start:n,end:t})).result.node;return{start:n,end:t,graphRef:a}}export{r as c};
