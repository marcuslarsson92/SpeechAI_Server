Dependencys to install:
firebase-admin




# Docker - (Prerequisites: Docker alreadu installed on your computer)
1. Open two seperate CLI
2. CLI #1: cd into /Speech-AI-client/
3. run the following command to build client image: docker build -t client:latest .
4. then: docker tag client:latest client:latest
5. CLI #2: cd into /SpeechAI-server/
6. run the following command to build server image: docker build -t server:latest .
7. then tag the image: docker tag server:latest server:latest
8. Both images are built. Great. Now, docker compose. Run command: docker compose -f docker-compose.yaml up --build
9. 
10. CLI #2 (/SpeechAI-server): To cleanup when you're done  docker compose down 
11. To restart, just run this again (CLI#2): docker compose -f docker-compose.yaml up --build





# More thorough cleanup with removal of stored data in volumes, and orphan containers:
 docker compose down --volumes --remove-orphans