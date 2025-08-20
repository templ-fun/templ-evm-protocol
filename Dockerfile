FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --production

COPY . .

EXPOSE 3002

CMD ["node", "src/tokenGatedService.js"]