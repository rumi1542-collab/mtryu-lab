// 이름 검사 (index.html의 badName과 같은 목록을 써요)
const BAD_WORDS = ['시발','씨발','씨바','시바','쉬발','시팔','씨팔','십팔','씹','병신','븅신','ㅂㅅ','ㅄ','ㅅㅂ','ㅆㅂ','지랄','ㅈㄹ','좆','존나','졸라','개새끼','새끼','섹스','보지','자지','창녀','걸레','꺼져','닥쳐','미친','ㅁㅊ','엿먹','애미','느금','니미','쌍놈','쌍년','썅','뒤져','fuck','shit','bitch','asshole','dick','pussy','porn','sex','nigg','cunt'];
// 한글·영문 글자만 남기고(숫자·기호·띄어쓰기로 돌려 쓴 것도 잡아요) 금지어가 들어 있는지 봐요
function badName(s) {
  const n = String(s || '').toLowerCase().replace(/[^가-힣ㄱ-ㅎㅏ-ㅣa-z]/g, '');
  return BAD_WORDS.some(w => n.includes(w));
}

module.exports = { badName };
