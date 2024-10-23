FROM node:20-alpine
RUN npm install -g nodemon
EXPOSE 3000
WORKDIR /app
COPY . .
RUN npm install
ENV DEBUG='server:*'
ENTRYPOINT [ "npm", "run", "dev"]