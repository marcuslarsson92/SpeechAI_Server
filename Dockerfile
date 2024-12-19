FROM node:20-alpine
RUN npm install -g nodemon
EXPOSE 3001
WORKDIR /app
COPY . .
RUN npm install
ENV DEBUG='server:*'
ENTRYPOINT [ "npm", "run", "dev"]