FROM node:18-alpine
RUN npm install -g nodemon
EXPOSE 3000
WORKDIR /app
COPY . .
RUN npm install
ENV DEBUG='speechai_server:*'
ENTRYPOINT [ "npm", "run", "dev"]