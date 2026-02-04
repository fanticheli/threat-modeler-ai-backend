FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

RUN mkdir -p /app/uploads

EXPOSE 3001

CMD ["npm", "run", "start:prod"]
