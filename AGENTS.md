HOW TO ACHIEVE SUCCESS AS A LLM WORKING IN TEMPL CODEBASE

1) before starting a task at least read the project readme so you understand a bit of our business domain, go deeper in code as needed

2) before handing over a finished task always make sure readme, natspec, and tests are updated and npm test passes. never leave comments about old implementations and removed thing, always just stating things as if they are the only veresion that ever existed
   
3) never care about compatibility with past deploys or external services, we are building this from 0 -> 1 no one uses it yet

4) tests should never jerry-rig something that is not really testing how prod works, test should always strive to give us complete trust in our codebase and that it correctly perform our business intentions

5) if you are going to run commants read package.json to make sure you run the correct scripts if they exist before invoking external npx calls for things we already have

6) protocol security is #1 priority, whenever developing anything always think in extremely adversive use-cases of that feature, templs should never be open to griefing outside it's own governance rules